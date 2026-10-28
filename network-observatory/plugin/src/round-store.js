// No Node native add-ons: this store also runs in Komari 1.4.3's Goja runtime.
const fs = require("fs"),
  path = require("path"),
  crypto = require("crypto");
const { UUID } = require("./model.js");
const MODULES = [
  "routes",
  "tcp-quality",
  "tcpquality-full",
  "china-speed",
  "international",
  "idc",
  "international-speed",
  "bgp",
];
const TERMINAL = [
  "ok",
  "partial",
  "application",
  "failed",
  "missing",
  "cancelled",
];
const DAY = 86400000;
function roundStore(root, isMissingFile, clock = () => Date.now()) {
  const base = path.join(root, "report-v3");
  let lastReceiptSweep = null, batchDepth = 0, flushing = false, cachedSlots = 0;
  const roundCache = new Map(), recoveredRounds = new Set(), dirtyRounds = new Map();
  const batchIndexes = new Map(), batchActive = new Map();
  function dropCached(key) {
    const entry = roundCache.get(key);
    if (entry) { cachedSlots -= entry.slots; roundCache.delete(key); }
  }
  function invalidate() { roundCache.clear(); recoveredRounds.clear(); cachedSlots = 0; }
  function stamp(file) {
    fs.accessSync(file);
    const stat = fs.statSync(file);
    return [stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino].join(":");
  }
  function remember(round, dirty = false) {
    const key = uuid(round.nodeUuid) + "/" + uuid(round.id), file = path.join(roundDir(round.nodeUuid, round.id), "manifest.json");
    const entry = { round, dirty, stamp: dirty ? null : stamp(file), slots: round.slots.length };
    dropCached(key); roundCache.set(key, entry); cachedSlots += entry.slots;
    // Keep an interleaved 52-node workload hot without allowing 128 maximum-
    // sized rounds to expand the old ~16 × 250-slot memory budget.
    while (roundCache.size && (roundCache.size > 128 || cachedSlots > 4096)) dropCached(roundCache.keys().next().value);
    recoveredRounds.add(key);
    if (recoveredRounds.size > 2048) recoveredRounds.delete(recoveredRounds.values().next().value);
  }
  function batch(fn) {
    batchDepth++;
    let result, failure;
    try {
      result = fn();
      if (result && typeof result.then === "function") throw new Error("报告批次仅支持同步操作");
    } catch (error) { failure = error; }
    batchDepth--;
    if (!batchDepth) {
      flushing = true;
      try {
        for (const round of dirtyRounds.values()) persist(round);
        for (const [file, rows] of batchIndexes) { if (maintenance) maintenance.beforeIndex(file, rows); write(file, rows); if (maintenance) maintenance.noteIndex(file, rows); }
        for (const [file, ids] of batchActive) write(file, ids);
      } catch (error) { failure = failure || error; }
      finally { dirtyRounds.clear(); batchIndexes.clear(); batchActive.clear(); flushing = false; }
    }
    if (failure) { invalidate(); throw failure; }
    return result;
  }
  function read(file, fallback) {
    // Goja resolves parent symlinks before stat and otherwise reports a missing
    // ancestor rather than this filename. Materialize parents before the check.
    try {
      // accessSync exposes ENOENT even for missing ancestors in Komari 1.4.3.
      // Reads must not recreate expired round directories.
      fs.accessSync(file);
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      if (isMissingFile(e, file)) return fallback;
      throw e;
    }
  }
  function write(file, value) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + ".tmp", JSON.stringify(value), { mode: 0o600 });
      fs.renameSync(file + ".tmp", file);
    } catch (error) { invalidate(); throw error; }
  }
  function uuid(value) {
    if (!UUID.test(value || "")) throw new Error("报告 UUID 无效");
    return value.toLowerCase();
  }
  function moduleName(value) {
    if (!MODULES.includes(value)) throw new Error("报告模块无效");
    return value;
  }
  const nodeDir = (node) => path.join(base, "nodes", uuid(node));
  const roundDir = (node, id) => path.join(nodeDir(node), "rounds", uuid(id));
  const deletedRoundDir = (node, id) => path.join(nodeDir(node), "rounds", ".deleting-" + uuid(id));
  const deletionDir = path.join(base, "full-delete-intents");
  const deletionIntent = (node, id) => path.join(deletionDir, uuid(node) + "_" + uuid(id) + ".json");
  let deletionQueue = null;
  function deletionPending(node, id) {
    const file = deletionIntent(node, id);
    try { fs.accessSync(file); return true; }
    catch (e) { if (isMissingFile(e, file)) return false; throw e; }
  }
  const slotFile = (node, id, slot) =>
    path.join(
      roundDir(node, id),
      "measurements",
      crypto.createHash("sha256").update(slot).digest("hex") + ".json",
    );
  function directories(dir) {
    fs.mkdirSync(dir, { recursive: true });
    try {
      return fs.readdirSync(dir);
    } catch (e) {
      if (isMissingFile(e, dir)) return [];
      throw e;
    }
  }
  function summarize(round) {
    const counts = {
      expected: round.slots.length,
      completed: 0,
      ok: 0,
      partial: 0,
      failed: 0,
      missing: 0,
      cancelled: 0,
    };
    for (const slot of round.slots) {
      if (TERMINAL.includes(slot.state)) counts.completed++;
      if (slot.state === "application") counts.ok++;
      else if (Object.prototype.hasOwnProperty.call(counts, slot.state))
        counts[slot.state]++;
    }
    const done = counts.completed === counts.expected;
    const state = !done
      ? "running"
      : counts.cancelled === counts.expected && counts.expected
        ? "cancelled"
        : counts.ok === counts.expected && counts.expected
          ? "complete"
          : counts.ok + counts.partial
            ? "partial"
            : counts.missing === counts.expected
              ? "missing"
              : "failed";
    return {
      id: round.id,
      nodeUuid: round.nodeUuid,
      module: round.module,
      family: round.parameters?.family,
      suiteId: round.suiteId,
      batchId: round.batchId,
      plannedAt: round.plannedAt,
      startedAt: round.startedAt,
      completedAt: round.completedAt || null,
      state,
      counts,
      schema: 3,
      detailAvailable: round.detailAvailable !== false,
    };
  }
  function index(round, force = false) {
    const date = round.plannedAt.slice(0, 10);
    const file = path.join(
      nodeDir(round.nodeUuid),
      "indexes",
      moduleName(round.module),
      date + ".json",
    );
    const current = batchIndexes.get(file) || read(file, []), summary = summarize(round);
    // Running/queued lease progress changes the manifest, not this summary.
    // Compare the actual day snapshot (or this batch's pending replacement),
    // so a missing/interrupted index commit is never hidden by a stale cache.
    const previous = current.find(row => row.id === round.id);
    if (!force && previous && JSON.stringify(previous) === JSON.stringify(summary)) return;
    const rows = current.filter(row => row.id !== round.id);
    rows.push(summary);
    rows.sort((a, b) => b.plannedAt.localeCompare(a.plannedAt) || b.id.localeCompare(a.id));
    if (batchDepth || flushing) batchIndexes.set(file, rows);
    else { if (maintenance) maintenance.beforeIndex(file, rows); write(file, rows); if (maintenance) maintenance.noteIndex(file, rows); }
  }
  function active(node, id, keep) {
    const file = path.join(nodeDir(node), "active.json");
    const current = batchActive.get(file) || read(file, []);
    if (current.includes(id) === keep) return;
    const ids = current.filter((value) => value !== id);
    if (keep) ids.push(id);
    if (batchDepth || flushing) batchActive.set(file, ids);
    // A new round must be discoverable even if its batch is interrupted.
    if (keep || !(batchDepth || flushing)) write(file, ids);
  }
  function save(round, immediate = false) {
    const summary = summarize(round);
    round.state = summary.state;
    round.counts = summary.counts;
    if (
      summary.counts.completed === summary.counts.expected &&
      !round.completedAt
    )
      round.completedAt = new Date(clock()).toISOString();
    if (summary.counts.completed === summary.counts.expected)
      delete round._jobs;
    else if (Array.isArray(round._jobs)) {
      // Only unfinished slots need recovery jobs. Keep their FIFO order and
      // original lease fields; committed measurements retain terminal history.
      const unfinished = new Set(round.slots.filter(slot => !TERMINAL.includes(slot.state)).map(slot => slot.jobId));
      round._jobs = round._jobs.filter(job => unfinished.has(job.id));
    }
    if (batchDepth && !immediate) {
      dirtyRounds.set(uuid(round.nodeUuid) + "/" + uuid(round.id), round); remember(round, true);
      return round;
    }
    return persist(round);
  }
  function persist(round) {
    write(path.join(roundDir(round.nodeUuid, round.id), "manifest.json"), round);
    index(round);
    active(
      round.nodeUuid,
      round.id,
      round.counts.completed !== round.counts.expected,
    );
    remember(round);
    return round;
  }
  function create(input) {
    uuid(input.nodeUuid);
    moduleName(input.module);
    if (input.module === "tcpquality-full" && input.id && deletionPending(input.nodeUuid, input.id)) throw new Error("报告正在删除，请稍后重试");
    if (
      !Array.isArray(input.slots) ||
      input.slots.length > 250 ||
      new Set(input.slots.map((s) => s.id)).size !== input.slots.length
    )
      throw new Error("每轮需要最多 250 个唯一目标槽位");
    const now = new Date(clock()).toISOString();
    const round = {
      ...input,
      schema: 3,
      id: uuid(input.id || crypto.randomUUID()),
      plannedAt: input.plannedAt || now,
      startedAt: now,
      completedAt: null,
      slots: input.slots.map((s) => ({ ...s, state: "queued" })),
    };
    if (
      !/^\d{4}-\d\d-\d\dT/.test(round.plannedAt) ||
      !Number.isFinite(Date.parse(round.plannedAt))
    )
      throw new Error("轮次时间无效");
    const existing = read(
      path.join(roundDir(round.nodeUuid, round.id), "manifest.json"),
      null,
    );
    if (existing) return existing;
    // Write-ahead active pointer lets restart recover without scanning all history.
    active(round.nodeUuid, round.id, true);
    return save(round, true);
  }
  function get(node, id, details = true) {
    const file = path.join(roundDir(node, id), "manifest.json"), key = uuid(node) + "/" + uuid(id);
    const entry = roundCache.get(key), dirty = dirtyRounds.get(key);
    let round;
    try {
      // Dirty state is the write-ahead batch's authoritative manifest. Its
      // lifetime must not depend on the small read-cache LRU: interleaved
      // batches can legitimately exceed the configured read-cache budget.
      round = dirty || (entry && (entry.dirty || entry.stamp === stamp(file)) ? entry.round : read(file, null));
    } catch (error) {
      dropCached(key); recoveredRounds.delete(key);
      if (isMissingFile(error, file)) return null;
      throw error;
    }
    if (!round) { dropCached(key); recoveredRounds.delete(key); return null; }
    // The intent is durable before any on-disk deletion; this also denies
    // late result recovery after a restart before the directory rename.
    if (round.module === "tcpquality-full" && deletionPending(node, id)) {
      dropCached(key); recoveredRounds.delete(key); return null;
    }
    // Measurement is written before manifest. Recover this commit after a crash.
    let recovered = false;
    const measurements = [];
    for (const slot of round.slots) {
      const mayHaveLateFull = round.module === "tcpquality-full" && slot.state === "failed" && !recoveredRounds.has(key);
      if (round.detailAvailable === false || (!details && !mayHaveLateFull && (recoveredRounds.has(key) || TERMINAL.includes(slot.state)))) continue;
      const result = read(slotFile(node, id, slot.id), null);
      if (!result) continue;
      if (!TERMINAL.includes(slot.state) || (round.module === "tcpquality-full" && result.data?.lateAfterDeadline === true && (slot.lateAfterDeadline !== true || slot.state !== result.data.state || slot.completedAt !== result.completedAt))) {
        slot.state = result.data.state;
        slot.completedAt = result.completedAt;
        if (result.data?.lateAfterDeadline === true) { round.completedAt = result.completedAt; slot.lateAfterDeadline = true; }
        slot.metrics = metrics(result.data);
        slot.source = result.source || slot.source;
        recovered = true;
      }
      if (details) measurements.push(result);
    }
    if (recovered) save(round);
    else if (!entry || round !== entry.round) remember(round, !!dirty);
    else { roundCache.delete(key); roundCache.set(key, entry); }
    const result = {
      ...round,
      detailAvailable: round.detailAvailable !== false,
      measurements: details ? measurements : undefined,
    };
    if (details) delete result._jobs;
    return result;
  }
  function measurement(node, id, slotId) {
    const round = get(node, id, false);
    if (!round || round.detailAvailable === false || !round.slots.some(slot => slot.id === slotId)) return null;
    return read(slotFile(node, id, slotId), null);
  }
  function metrics(data) {
    const value = {
      kind: data.kind,
      state: data.state,
      method: data.method,
      toolVersion: data.toolVersion,
      protocol: data.protocol,
      family: data.family,
      resolvedIp: data.resolvedIp,
      warmupSeconds: data.warmupSeconds,
      actualEndpoint: data.actualEndpoint,
      routeEvidence: data.routeEvidence,
      synProbes: data.synProbes,
    };
    if (data.tcpQuality)
      Object.assign(value, {
        address: data.tcpQuality.address,
        medianMs: data.tcpQuality.medianMs,
        received: data.tcpQuality.received,
        sent: data.tcpQuality.sent,
      });
    if (data.hops)
      Object.assign(value, {
        hops: data.hops.length,
        complete: data.complete,
        asPath: data.hops.map((h) => h.asn || "?"),
      });
    if (data.runs)
      value.runs = data.runs.map((r) => ({
        state: r.state,
        measurementBasis: r.measurementBasis,
        intervalSource: r.intervalSource,
        remoteIp: r.remoteIp,
        streams: r.streams,
        vpsDirection: r.vpsDirection,
        bitsPerSecond: r.bitsPerSecond,
        maxBitsPerSecond: r.maxBitsPerSecond,
        tcpRttMs: r.tcpRttMs,
        retransmits: r.retransmits,
        bytes: r.bytes,
        seconds: r.seconds,
        trafficBytesObserved: r.trafficBytesObserved,
        congestionControl: r.congestionControl,
        tcpRttMethod: r.tcpRttMethod,
        tcpSampleSide: r.tcpSampleSide,
      }));
    if (data.prefix)
      Object.assign(value, {
        prefix: data.prefix,
        originAsns: data.originAsns,
        rpki: data.rpki,
        sources: data.sources,
      });
    return value;
  }
  function complete(job, data, source) {
    if (!job.roundId) return null;
    const round = get(job.nodeUuid, job.roundId, false);
    if (!round) throw new Error("任务关联轮次不存在");
    const slot = round.slots.find((s) => s.id === job.slotId);
    if (!slot || slot.jobId !== job.id) throw new Error("任务不属于本轮目标");
    if (!TERMINAL.includes(data.state)) throw new Error("结果尚未收尾");
    const output = slotFile(job.nodeUuid, job.roundId, slot.id);
    const existing = read(output, null);
    const result = existing || {
      id: job.id,
      roundId: round.id,
      slotId: slot.id,
      nodeUuid: job.nodeUuid,
      target: job.target,
      operation: job.operation,
      direction: job.direction,
      pairId: job.pairId || "",
      options: job.options,
      source: source || job.source,
      executor: job.executor,
      startedAt: job.startedAt || null,
      completedAt: new Date(clock()).toISOString(),
      data,
    };
    if (!existing) write(output, result);
    // Only the authenticated owner may replay a result receipt.
    const receiptData = {
      executor: job.executor,
      nodeUuid: job.nodeUuid,
      roundId: round.id,
      slotId: job.slotId,
      operation: job.operation,
      at: clock(),
    };
    maintenance.writeReceipt(uuid(job.id), receiptData);
    if (job.operation === "tcpquality-full") write(path.join(base, "full-receipts", uuid(job.id) + ".json"), receiptData);
    slot.state = result.data.state;
    slot.metrics = metrics(result.data);
    slot.source = result.source || slot.source;
    slot.completedAt = result.completedAt;
    save(round);
    return result;
  }
  function receipt(jobId, executor) {
    if (!UUID.test(jobId || "")) return false;
    const full = read(path.join(base, "full-receipts", uuid(jobId) + ".json"), null);
    const value = full || maintenance.receipt(jobId);
    return !!value && value.executor === executor && (!!full || clock() - value.at < 7 * DAY);
  }
  function acceptLateFull(jobId, executor, data) {
    if (!UUID.test(jobId || "")) return false;
    const receipt = read(path.join(base, "full-receipts", uuid(jobId) + ".json"), null);
    if (!receipt || receipt.executor !== executor || receipt.operation !== "tcpquality-full") return false;
    const round = get(receipt.nodeUuid, receipt.roundId, false);
    if (!round || round.module !== "tcpquality-full" || round.detailAvailable === false) return false;
    const slot = round.slots.find(s => s.id === receipt.slotId && s.jobId === jobId);
    if (!slot) return false;
    const output = slotFile(receipt.nodeUuid, receipt.roundId, slot.id), result = read(output, null);
    if (!result || result.id !== jobId || result.executor !== executor || result.data?.deadlineExpired !== true || result.data.state !== "failed") return false;
    // Persist the replacement before the manifest. The retry path also repairs
    // a crash between these commits without allowing cancellation overrides.
    const updated = { ...result, data: { ...data, lateAfterDeadline: true }, completedAt: new Date(clock()).toISOString() };
    write(output, updated);
    slot.state = updated.data.state; slot.metrics = metrics(updated.data); slot.completedAt = updated.completedAt; slot.lateAfterDeadline = true;
    round.completedAt = updated.completedAt;
    save(round);
    return true;
  }
  function updateFullReportUrl(jobId, executor, data) {
    if (!UUID.test(jobId || "") || !/^https:\/\/tcpquality\.ibsgss\.uk\/r\/[A-Za-z0-9_-]{1,128}$/.test(data?.reportUrl || "")) return "invalid";
    const receipt = read(path.join(base, "full-receipts", uuid(jobId) + ".json"), null);
    if (!receipt || receipt.executor !== executor || receipt.operation !== "tcpquality-full") return "invalid";
    const round = get(receipt.nodeUuid, receipt.roundId, false);
    if (!round || round.module !== "tcpquality-full" || round.detailAvailable === false) return "invalid";
    const slot = round.slots.find(s => s.id === receipt.slotId && s.jobId === jobId);
    if (!slot || slot.state === "cancelled") return "invalid";
    const output = slotFile(receipt.nodeUuid, receipt.roundId, slot.id), result = read(output, null);
    if (!result || result.id !== jobId || result.executor !== executor || !(result.data?.state === "partial" || (result.data?.state === "ok" && result.data.reportUrl))) return "invalid";
    const original = { ...result.data }, incoming = { ...data };
    delete original.reportUrl; delete original.lateAfterDeadline; delete incoming.reportUrl;
    const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ?
      Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    if (JSON.stringify(canonical(original)) !== JSON.stringify(canonical(incoming))) return "invalid";
    if (result.data.reportUrl) return result.data.reportUrl === data.reportUrl ? "unchanged" : "invalid";
    // Only this URL changes; the measurement itself, timestamps, state and
    // round index remain identical. Atomic replacement makes retries safe.
    write(output, { ...result, data: { ...result.data, reportUrl: data.reportUrl } });
    return "updated";
  }
  function progress(job) {
    if (!job.roundId) return;
    const round = get(job.nodeUuid, job.roundId, false);
    const slot = round?.slots.find((s) => s.id === job.slotId);
    if (slot && !TERMINAL.includes(slot.state)) {
      slot.state = ["queued", "shared"].includes(job.phase)
        ? "queued"
        : "running";
      slot.waitReason = job.waitReason || "";
      if (round._jobs)
        round._jobs = round._jobs.map((j) =>
          j.id === job.id
            ? {
                ...job,
                password: undefined,
                publicKey: undefined,
                credentials: undefined,
              }
            : j,
        );
      save(round);
    }
  }
  function list(node, module, options = {}) {
    const limit = Math.max(1, Math.min(50, Number(options.limit) || 20));
    const directory = path.join(nodeDir(node), "indexes", moduleName(module));
    const cursor = options.cursor || "";
    if (cursor && !/^\d{4}-\d\d-\d\dT[0-9:.Z+-]+\|[0-9a-f-]{36}$/.test(cursor))
      throw new Error("分页游标无效");
    const rows = [];
    for (const name of directories(directory)
      .filter((s) => /^\d{4}-\d\d-\d\d\.json$/.test(s))
      .sort()
      .reverse()) {
      for (const row of read(path.join(directory, name), [])) {
        if (module === "tcpquality-full" && UUID.test(row.id || "") && deletionPending(node, row.id)) {
          resumeFullDeletion(node, row.id);
          continue;
        }
        // A crash after the atomic rename in deleteFullRound can leave an
        // index row behind. Finish that deletion before exposing the row.
        if (module === "tcpquality-full" && UUID.test(row.id || "")) {
          const tomb = deletedRoundDir(node, row.id);
          let deleting = false;
          try {
            fs.accessSync(tomb);
            deleting = true;
          } catch (e) {
            if (!isMissingFile(e, tomb)) throw e;
          }
          if (deleting) { finalizeDeletedFull(node, row.id); continue; }
        }
        const key = row.plannedAt + "|" + row.id;
        if (!cursor || key < cursor) rows.push(row);
      }
      if (rows.length > limit) break;
    }
    rows.sort((a, b) =>
      (b.plannedAt + "|" + b.id).localeCompare(a.plannedAt + "|" + a.id),
    );
    return {
      rounds: rows.slice(0, limit),
      nextCursor:
        rows.length > limit
          ? rows[limit - 1].plannedAt + "|" + rows[limit - 1].id
          : null,
      retention: module === "tcpquality-full" ? { detailDays: null, summaryDays: null } : { detailDays: 7, summaryDays: 90 },
    };
  }
  function finalizeDeletedFull(node, id) {
    const tomb = deletedRoundDir(node, id);
    const round = read(path.join(tomb, "manifest.json"), null);
    if (!round) return false;
    if (uuid(round.nodeUuid) !== uuid(node) || uuid(round.id) !== uuid(id) || round.module !== "tcpquality-full" || !Array.isArray(round.slots) || round.slots.some(slot => !TERMINAL.includes(slot.state)))
      throw new Error("待删除报告记录无效");
    const file = path.join(nodeDir(node), "indexes", moduleName(round.module), round.plannedAt.slice(0, 10) + ".json");
    const rows = read(file, []).filter(row => row.id !== round.id);
    if (rows.length) { maintenance.beforeIndex(file, rows); write(file, rows); }
    else { try { fs.unlinkSync(file); } catch (e) { if (!isMissingFile(e, file)) throw e; } }
    maintenance.noteIndex(file, rows);
    for (const slot of round.slots) {
      const file = path.join(base, "full-receipts", uuid(slot.jobId) + ".json");
      const receipt = read(file, null) || maintenance.receipt(slot.jobId);
      if (receipt && receipt.nodeUuid === round.nodeUuid && receipt.roundId === round.id && Number.isFinite(receipt.at))
        maintenance.deleteReceipt(slot.jobId, receipt.at);
      try { fs.unlinkSync(file); } catch (e) { if (!isMissingFile(e, file)) throw e; }
    }
    active(node, id, false);
    // The index and receipts are gone before removing the manifest needed to
    // resume a deletion after a crash. Never restore a renamed directory.
    fs.rmSync(tomb, { recursive: true, force: true });
    const key = uuid(node) + "/" + uuid(id); dropCached(key); recoveredRounds.delete(key);
    return true;
  }
  function deleteFullRound(node, id) {
    if (deletionPending(node, id)) return resumeFullDeletion(node, id);
    const round = get(node, id, false);
    if (!round) return finalizeDeletedFull(node, id);
    if (round.module !== "tcpquality-full") throw new Error("仅支持删除完整 TcpQuality 报告");
    if (round.slots.some(slot => !TERMINAL.includes(slot.state))) throw new Error("检测仍在进行，请先取消");
    // The intent is written before the rename, so a crash at either boundary
    // cannot make the report visible or allow a late result to replace it.
    write(deletionIntent(node, id), { nodeUuid: uuid(node), id: uuid(id) });
    deletionQueue = null;
    const key = uuid(node) + "/" + uuid(id); dropCached(key); recoveredRounds.delete(key);
    return resumeFullDeletion(node, id);
  }
  function resumeFullDeletion(node, id) {
    const intentFile = deletionIntent(node, id), intent = read(intentFile, null);
    if (!intent) return false;
    if (intent.nodeUuid !== uuid(node) || intent.id !== uuid(id)) throw new Error("删除意图无效");
    const tomb = deletedRoundDir(node, id), manifest = path.join(tomb, "manifest.json");
    let deleted = read(manifest, null);
    if (!deleted) {
      const live = read(path.join(roundDir(node, id), "manifest.json"), null);
      if (live) {
        if (uuid(live.nodeUuid) !== uuid(node) || uuid(live.id) !== uuid(id) || live.module !== "tcpquality-full" || !Array.isArray(live.slots) || live.slots.some(slot => !TERMINAL.includes(slot.state))) throw new Error("待删除报告记录无效");
        fs.renameSync(roundDir(node, id), tomb);
        deleted = live;
      }
    }
    if (deleted) finalizeDeletedFull(node, id);
    else fs.rmSync(tomb, { recursive: true, force: true }); // A prior removal was interrupted after index and receipts were removed.
    try { fs.unlinkSync(intentFile); } catch (e) { if (!isMissingFile(e, intentFile)) throw e; }
    return true;
  }
  function recoverOneFullDeletion() {
    if (!deletionQueue) deletionQueue = directories(deletionDir).filter(name => /^[0-9a-f-]{36}_[0-9a-f-]{36}\.json$/i.test(name)).sort();
    const name = deletionQueue.shift();
    if (!name) { deletionQueue = null; return false; }
    const [node, id] = name.slice(0, -5).split("_");
    if (!UUID.test(node) || !UUID.test(id)) return true;
    try { resumeFullDeletion(node, id); }
    catch (error) { deletionQueue = null; throw error; }
    return true;
  }
  function rebuild(node) {
    let rebuilt = 0;
    for (const id of directories(path.join(nodeDir(node), "rounds")).filter(
      (s) => UUID.test(s),
    )) {
      const round = get(node, id, false);
      if (round) {
        index(round, true);
        rebuilt++;
      }
    }
    return rebuilt;
  }
  function pending(node) {
    const jobs = [];
    for (const id of read(path.join(nodeDir(node), "active.json"), [])) {
      const round = get(node, id, false);
      if (!round) {
        active(node, id, false);
        continue;
      }
      save(round); // Repair an index commit interrupted after the manifest write.
      for (const slot of round.slots.filter(
        (s) => !TERMINAL.includes(s.state),
      )) {
        const job = round._jobs?.find((j) => j.id === slot.jobId);
        if (job) jobs.push(job);
      }
    }
    return jobs;
  }
  function cleanup(node) {
    for (const module of MODULES) {
      if (module === "tcpquality-full") continue;
      const directory = path.join(nodeDir(node), "indexes", module);
      for (const name of directories(directory).filter((s) =>
        /^\d{4}-\d\d-\d\d\.json$/.test(s),
      )) {
        const file = path.join(directory, name),
          rows = read(file, []),
          kept = [];
        let changed = false;
        for (const row of rows) {
          if (!row.completedAt) {
            kept.push(row);
            continue;
          }
          const age = clock() - Date.parse(row.completedAt);
          if (age > 7 * DAY && row.detailAvailable) {
            changed = true;
            const folder = path.join(roundDir(node, row.id), "measurements");
            fs.rmSync(folder, { recursive: true, force: true });
            row.detailAvailable = false;
            const manifest = read(
              path.join(roundDir(node, row.id), "manifest.json"),
              null,
            );
            if (manifest) {
              manifest.detailAvailable = false;
              write(
                path.join(roundDir(node, row.id), "manifest.json"),
                manifest,
              );
            }
          }
          if (age <= 90 * DAY) kept.push(row);
          else {
            changed = true;
            fs.rmSync(roundDir(node, row.id), { recursive: true, force: true });
          }
        }
        if (kept.length) { if (changed) write(file, kept); }
        else fs.unlinkSync(file);
      }
    }
    // Receipts contain no credentials and are bounded by a seven-day retry window.
    // This directory is global: scan once per maintenance pass, not once for
    // every VPS (which multiplies all result-file reads by the node count).
    const now = clock();
    if (lastReceiptSweep !== null && now - lastReceiptSweep < 3600000) return;
    const receiptRoot = path.join(base, "receipts");
    for (const name of directories(receiptRoot)) {
      const names = /^\d{4}-\d\d-\d\d$/.test(name)
        ? directories(path.join(receiptRoot, name)).map(child => path.join(name, child)) : [name];
      for (const relative of names) {
        const basename = path.basename(relative);
        if (!UUID.test(basename.slice(0, -5)) || !basename.endsWith(".json")) continue;
        const file = path.join(receiptRoot, relative), value = read(file, null);
        if (value && now - value.at > 7 * DAY) fs.unlinkSync(file);
      }
    }
    lastReceiptSweep = now;
  }
  const maintenance = require("./retention-store.js").retentionStore({ base, modules: MODULES, nodeDir, roundDir,
    read, write, missing: isMissingFile, clock,
    recoverOneFullDeletion,
    invalidateRound: (node, id) => { const key = uuid(node) + "/" + uuid(id); dropCached(key); recoveredRounds.delete(key); },
  });
  return {
    batch,
    measurement,
    maintenanceStep: maintenance.maintenanceStep,
    create,
    get,
    complete,
    progress,
    receipt,
    acceptLateFull,
    updateFullReportUrl,
    list,
    rebuild,
    deleteFullRound,
    cleanup,
    summarize,
    pending,
  };
}
module.exports = { roundStore, MODULES, TERMINAL };
