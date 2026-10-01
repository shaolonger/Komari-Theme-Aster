// No Node native add-ons: this store also runs in Komari 1.4.3's Goja runtime.
const fs = require("fs"),
  path = require("path"),
  crypto = require("crypto");
const { UUID } = require("./model.js");
const MODULES = [
  "routes",
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
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + ".tmp", JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(file + ".tmp", file);
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
  const receiptFile = (id) => path.join(base, "receipts", uuid(id) + ".json");
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
  function index(round) {
    const date = round.plannedAt.slice(0, 10);
    const file = path.join(
      nodeDir(round.nodeUuid),
      "indexes",
      moduleName(round.module),
      date + ".json",
    );
    const rows = read(file, []).filter((row) => row.id !== round.id);
    rows.push(summarize(round));
    write(
      file,
      rows.sort(
        (a, b) =>
          b.plannedAt.localeCompare(a.plannedAt) || b.id.localeCompare(a.id),
      ),
    );
  }
  function active(node, id, keep) {
    const file = path.join(nodeDir(node), "active.json");
    const ids = read(file, []).filter((value) => value !== id);
    if (keep) ids.push(id);
    write(file, ids);
  }
  function save(round) {
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
    write(
      path.join(roundDir(round.nodeUuid, round.id), "manifest.json"),
      round,
    );
    index(round);
    active(
      round.nodeUuid,
      round.id,
      summary.counts.completed !== summary.counts.expected,
    );
    return round;
  }
  function create(input) {
    uuid(input.nodeUuid);
    moduleName(input.module);
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
    return save(round);
  }
  function get(node, id, details = true) {
    const round = read(path.join(roundDir(node, id), "manifest.json"), null);
    if (!round) return null;
    // Measurement is written before manifest. Recover this commit after a crash.
    let recovered = false;
    const measurements = [];
    for (const slot of round.slots) {
      const result = read(slotFile(node, id, slot.id), null);
      if (!result) continue;
      if (!TERMINAL.includes(slot.state)) {
        slot.state = result.data.state;
        slot.completedAt = result.completedAt;
        slot.metrics = metrics(result.data);
        slot.source = result.source || slot.source;
        recovered = true;
      }
      if (details) measurements.push(result);
    }
    if (recovered) save(round);
    const result = {
      ...round,
      detailAvailable: round.detailAvailable !== false,
      measurements: details ? measurements : undefined,
    };
    if (details) delete result._jobs;
    return result;
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
    write(receiptFile(job.id), {
      executor: job.executor,
      nodeUuid: job.nodeUuid,
      roundId: round.id,
      at: clock(),
    });
    slot.state = result.data.state;
    slot.metrics = metrics(result.data);
    slot.source = result.source || slot.source;
    slot.completedAt = result.completedAt;
    save(round);
    return result;
  }
  function receipt(jobId, executor) {
    if (!UUID.test(jobId || "")) return false;
    const value = read(receiptFile(jobId), null);
    return (
      !!value && value.executor === executor && clock() - value.at < 7 * DAY
    );
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
      retention: { detailDays: 7, summaryDays: 90 },
    };
  }
  function rebuild(node) {
    let rebuilt = 0;
    for (const id of directories(path.join(nodeDir(node), "rounds")).filter(
      (s) => UUID.test(s),
    )) {
      const round = get(node, id, false);
      if (round) {
        index(round);
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
      const directory = path.join(nodeDir(node), "indexes", module);
      for (const name of directories(directory).filter((s) =>
        /^\d{4}-\d\d-\d\d\.json$/.test(s),
      )) {
        const file = path.join(directory, name),
          rows = read(file, []),
          kept = [];
        for (const row of rows) {
          if (!row.completedAt) {
            kept.push(row);
            continue;
          }
          const age = clock() - Date.parse(row.completedAt);
          if (age > 7 * DAY && row.detailAvailable) {
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
            fs.rmSync(roundDir(node, row.id), { recursive: true, force: true });
          }
        }
        if (kept.length) write(file, kept);
        else fs.unlinkSync(file);
      }
    }
    // Receipts contain no credentials and are bounded by a seven-day retry window.
    for (const name of directories(path.join(base, "receipts")).filter(
      (s) => UUID.test(s.slice(0, -5)) && s.endsWith(".json"),
    )) {
      const file = path.join(base, "receipts", name),
        value = read(file, null);
      if (value?.nodeUuid === node && clock() - value.at > 7 * DAY)
        fs.unlinkSync(file);
    }
  }
  return {
    create,
    get,
    complete,
    progress,
    receipt,
    list,
    rebuild,
    cleanup,
    summarize,
    pending,
  };
}
module.exports = { roundStore, MODULES, TERMINAL };
