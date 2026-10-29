const crypto = require("crypto");
const fs = require("fs");
const { UUID } = require("./model.js");
const M = require("./native-model.js");
const R = require("./report-model.js");
const { roundStore, MODULES } = require("./round-store.js");
const { VERSION, PRESETS } = require("./report-catalog.js");
const B = require("./bgp.js");
const { originQuery } = require("./route-enrichment.js");
const BASE = "/api/aster-network-observatory/v3";
const MAX_QUEUE = 10000;
const measurementKey = (j) =>
  JSON.stringify([
    j.nodeUuid,
    j.executor,
    j.operation,
    j.target,
    j.options,
    j.source,
  ]);
function shareJob(job, candidate, plannedAt) {
  job.plannedAt = plannedAt;
  if (
    candidate &&
    Math.abs((candidate.plannedAt || candidate.queuedAt) - plannedAt) < 60000
  ) {
    job.sharedJobId = candidate.id;
    job.sharedRoundId = candidate.roundId;
    job.phase = "shared";
    job.waitReason = "相同测量由另一方案的本轮任务执行；结果将写入各自轮次";
  }
}
function registerReportController(ctx, native) {
  const store = roundStore(ctx.storageDir, ctx.isMissingFile);
  const bgp = B.createBgpCollector(ctx.bgpOptions);
  const homeRoutes = require("./home-routes.js").homeRouteStore(ctx.storageDir, ctx.isMissingFile);
  const homeSpeeds = require("./home-speeds.js").homeSpeedStore(ctx.storageDir, ctx.isMissingFile);
  const speedHistoryChecked = new Set();
  const speedHistoryQueue = new Map();
  let speedHistoryTimer = null;
  const routeHistoryQueue = new Map();
  let routeHistoryTimer = null, routeHistoryRetryAt = 0;
  let recovered = false;
  let bgpBusy = false;
  let dispatchTimer = null, maintenanceTimer = null;
  let projectionDepth = 0;
  const pendingSpeedProjections = new Map();
  const performance = {
    since: new Date().toISOString(),
    dispatch: { slices: 0, lastMs: 0, maxMs: 0, slowSlices: 0 },
    maintenance: { slices: 0, steps: 0, lastMs: 0, maxMs: 0, slowSlices: 0, pending: false, nextAt: 0 },
  };
  let lastSlowLogAt = 0;
  function recordSlice(name, started) {
    const elapsed = Date.now() - started, stats = performance[name];
    stats.slices++; stats.lastMs = elapsed; stats.maxMs = Math.max(stats.maxMs, elapsed);
    if (elapsed > 50) stats.slowSlices++;
    if (elapsed > 250 && Date.now() - lastSlowLogAt > 60000) {
      lastSlowLogAt = Date.now();
      console.warn("Aster background slice:", name, elapsed + "ms");
    }
  }
  const capabilities = {
    schema: 3,
    features: [
      "rounds",
      "latency-samples",
      "full-mtr",
      "bgp-rpki",
      "speed-intervals",
      "http-speed", "tcp-quality", "public-speed", "tcpquality-full", "nodequality-full",
    ],
    modules: MODULES,
    maxTargetsPerRound: 250,
    retention: { detailDays: 7, summaryDays: 90 },
  };
  function completeAndProject(job, data, source) {
    if (data.kind === "route") data = { ...data, routeEvidence: require("./route-evidence.js").routeFacts(data.hops || []) };
    const result = store.complete(job, data, source);
    if (result) {
      try { homeRoutes.observe(result, projectionDepth === 0); }
      catch (e) { console.error("Aster homepage route projection:", String(e.message || e)); }
      if (data.kind === "speed") {
        if (projectionDepth) {
          pendingSpeedProjections.set(job.roundId, { node: job.nodeUuid, id: job.roundId });
          return result;
        }
        try {
          const round = store.get(job.nodeUuid, job.roundId, false);
          if (round?.module === "china-speed" && round.completedAt) homeSpeeds.observe(round);
        } catch (e) { console.error("Aster homepage speed projection:", String(e.message || e)); }
      }
    }
    return result;
  }
  // Measurements and receipts remain write-ahead commits. Within a synchronous
  // operation, flush each round/index and public projection once at the end.
  function batch(fn) {
    projectionDepth++;
    try { return store.batch(fn); }
    finally {
      projectionDepth--;
      if (!projectionDepth) {
        try { homeRoutes.save(); }
        catch (error) { console.error("Aster route projection flush:", String(error.message || error)); }
        for (const value of pendingSpeedProjections.values()) {
          try {
            const round = store.get(value.node, value.id, false);
            if (round?.completedAt) homeSpeeds.observe(round);
          } catch (error) { console.error("Aster speed projection flush:", String(error.message || error)); }
        }
        pendingSpeedProjections.clear();
      }
    }
  }
  function state(s) {
    s.reportSuites ||= [];
    s.reportResources ||= [];
    s.reportDispatch ||= [];
    return s;
  }
  function members(suite, s) {
    const clients = new Set(suite.clients), groups = new Set(suite.groups);
    return s.inventory.filter(node => clients.has(node.uuid) || groups.has(node.group));
  }
  function route(method, suffix, fn) {
    ctx.server.route(method, BASE + suffix, async (req, res) => {
      if (!ctx.authorized(req, res)) return;
      try {
        await native.lock(async () => {
          const s = state(native.read());
          await fn(req, res, s);
        });
      } catch (e) {
        ctx.respond(res, 400, { error: String(e.message || e) });
      }
    });
  }
  function part(req, position) {
    return decodeURIComponent(
      String(req.url).split("?", 1)[0].slice(BASE.length).split("/")[position],
    );
  }
  function query(req, key) {
    const tail = String(req.url).split("?")[1] || "";
    const row = tail.split("&").find((value) => value.split("=", 1)[0] === key);
    return row ? decodeURIComponent(row.slice(row.indexOf("=") + 1)) : "";
  }
  function cardCandidates(s, uuid, module, family) {
    return s.reportSuites.filter(suite => suite.enabled && (module !== "china-speed" || suite.trafficAccepted) &&
      members(suite, s).some(node => node.uuid === uuid)).flatMap(suite =>
      suite.modules.filter(mod => mod.enabled && mod.module === module && mod.family === family).map(mod => ({ suite, mod })));
  }
  function cardFamilies(s, module) {
    const result = {};
    for (const suite of s.reportSuites.filter(p => p.enabled && (module !== "china-speed" || p.trafficAccepted))) {
      const families = suite.modules.filter(m => m.enabled && m.module === module).map(m => m.family);
      if (families.length) for (const node of members(suite, s)) result[node.uuid] = [...new Set([...(result[node.uuid] || []), ...families])];
    }
    return result;
  }
  function cardProgress(s, uuid, id) {
    const round = store.get(uuid, id, false);
    if (!round) return { nodeUuid: uuid, id, phase: "unavailable", state: "missing", counts: { expected: 0, completed: 0, ok: 0, partial: 0, failed: 0, missing: 0, cancelled: 0 } };
    if (!["routes", "china-speed"].includes(round.module)) throw new Error("卡片检测仅支持大陆线路和大陆测速");
    // Unconfigured cells in the speed report's nine-cell grid are not work.
    const slots = round.module === "china-speed" ? round.slots.filter(slot => slot.target || slot.endpoint || slot.source?.id) : round.slots;
    const summary = store.summarize({ ...round, slots });
    const complete = round.slots.every(slot => ["ok", "partial", "failed", "missing", "cancelled", "application"].includes(slot.state));
    const jobs = native.pendingJobsFor(s, uuid, round.suiteId, round.module).filter(j => j.roundId === id);
    const running = jobs.some(j => ["running", "ready", "listening", "provider", "submitting"].includes(j.phase));
    const wait = jobs.find(j => j.waitReason);
    return { nodeUuid: uuid, id, module: round.module, family: round.parameters.family,
      phase: complete ? "finished" : running ? "running" : "queued", state: summary.state,
      counts: summary.counts, completedAt: round.completedAt || null,
      waitReason: wait?.waitReason || (!complete && !running ? "等待测量端或公共端点队列" : ""),
      suiteName: s.reportSuites.find(p => p.id === round.suiteId)?.name || "网络报告" };
  }
  route("POST", "/nodes/:uuid/card-check", (req, res, s) => {
    const uuid = part(req, 2), { module, family } = ctx.readBody(req);
    if (!UUID.test(uuid) || !["routes", "china-speed"].includes(module) || !["4", "6"].includes(family)) throw new Error("卡片检测范围无效");
    const candidates = cardCandidates(s, uuid, module, family);
    if (!candidates.length) throw new Error(`此 VPS 尚未配置已启用的 IPv${family} ${module === "routes" ? "大陆线路" : "大陆测速"}方案，请先配置检测方案`);
    const active = candidates.flatMap(({ suite }) => native.pendingJobsFor(s, uuid, suite.id, module)).find(j => j.options.family === family);
    if (active) { ctx.respond(res, 202, cardProgress(s, uuid, active.roundId)); return; }
    // Prefer the most recently used matching plan, not every plan on the VPS.
    const recent = store.list(uuid, module, { limit: 20 }).rounds.find(r => r.family === family && candidates.some(c => c.suite.id === r.suiteId));
    const chosen = candidates.find(c => c.suite.id === recent?.suiteId) || candidates[0];
    const dispatch = s.reportDispatch.find(work => work.suiteId === chosen.suite.id && work.module === module && work.nodes.slice(work.cursor).includes(uuid));
    const id = enqueue(s, chosen.suite, chosen.mod, uuid, dispatch?.batchId || crypto.randomUUID(), dispatch?.plannedAt || Date.now(), false,
      dispatch ? dispatchRoundId(dispatch, uuid) : undefined);
    if (!id) throw new Error("此方案已有检测正在收尾，请稍后重试");
    native.save(s);
    ctx.respond(res, 202, cardProgress(s, uuid, id));
  });
  route("POST", "/card-checks/progress", (req, res, s) => {
    const { checks } = ctx.readBody(req);
    if (!Array.isArray(checks) || checks.length > 64 || checks.some(c => !UUID.test(c?.nodeUuid || "") || !UUID.test(c?.id || ""))) throw new Error("检测进度查询范围无效");
    ctx.respond(res, 200, { checks: checks.map(c => cardProgress(s, c.nodeUuid, c.id)) });
  });
  function readiness(s, job, previewOnly = false) {
    if (job.missingReason) return job.missingReason;
    if (job.executor === "bgp")
      return originQuery(job.target)
        ? ""
        : "BGP 快照需要 VPS 的公网 IP；域名、私网与保留地址不作为路由证据";
    if (job.executor === "globalping")
      return previewOnly ? native.coverage(s, job) : ""; // Discovery at execution occurs outside the state lock.
    if (
      !["latency", "route", "benchmark", "http-speed", "iperf-speed", "public-speed", "tcp-quality", "tcpquality-full", "nodequality-full"].includes(
        job.operation,
      )
    )
      return "当前采集器未提供此测量操作";
    const required = ["tcp-quality", "public-speed", "tcpquality-full", "nodequality-full"].includes(job.operation) ? job.operation :
      job.operation === "latency"
        ? "latency-samples"
        : job.operation === "route"
          ? "full-mtr"
          : job.operation === "http-speed"
            ? "http-speed"
            : job.operation === "iperf-speed"
              ? "speed-intervals"
              : "report-v3";
    if (!s.workers[job.executor]?.features?.includes(required))
      return "测量端未就绪或需要升级探测器以支持新版报告";
    return native.coverage(s, job);
  }
  function preview(s, suite) {
    const nodes = members(suite, s);
    const capacity = {};
    const suites = [
      ...s.reportSuites.filter((p) => p.id !== suite.id && p.enabled),
      suite,
    ];
    for (const p of suites)
      for (const node of members(p, s)) {
        const usage = (capacity[node.uuid] ||= {
          measurementsPerDay: 0,
          samplesPerDay: 0,
          speedSecondsPerDay: 0,
          estimatedLightSecondsPerDay: 0,
        });
        for (const mod of p.modules.filter((m) => m.enabled)) {
          const plan = R.planSlots(s, p, mod, node.uuid, crypto.randomUUID());
          const frequency = timing => timing.type === "rules" ? timing.rules.reduce((sum, rule) => sum + frequency(rule), 0) :
            timing.type === "daily" ? timing.times.length : timing.type === "every-days" ? 1 / timing.days : timing.type === "weekly" ? timing.weekdays.length / 7 : 1440 / timing.minutes;
          const times = frequency(mod.timing);
          usage.measurementsPerDay += times * plan.jobs.length;
          if (["international", "idc", "tcp-quality"].includes(mod.module)) {
            usage.samplesPerDay += times * plan.jobs.length * (mod.samples || 10) * (mod.module === "tcp-quality" ? 1 + (mod.packetSizes || []).length : 1);
            usage.estimatedLightSecondsPerDay +=
              times * plan.jobs.length * (mod.module === "tcp-quality" ? 18 + 15 * (mod.packetSizes || []).length : 18 / 4);
          }
          if (mod.module.endsWith("speed"))
            usage.speedSecondsPerDay +=
              times *
              plan.jobs.filter((j) => !j.missingReason).length *
              2 *
              (mod.seconds + mod.warmupSeconds) *
              mod.streams.length;
        }
      }
    return {
      suite,
      nodes: nodes.map((n) => ({
        ...n,
        capacity: capacity[n.uuid],
        modules: suite.modules.map((mod) => {
          const plan = R.planSlots(s, suite, mod, n.uuid, crypto.randomUUID());
          return {
            module: mod.module,
            nextAt: mod.nextAt,
            expected: plan.slots.length,
            targets: plan.jobs.map((j) => ({
              slotId: j.slotId,
              target: j.target,
              direction: j.direction,
              source: j.source,
              ready: !readiness(s, j, true),
              reason: readiness(s, j, true),
            })),
            estimatedQueueSeconds:
              plan.jobs.filter((j) => !readiness(s, j)).length *
              (mod.module.endsWith("speed")
                ? 2 * (mod.seconds + mod.warmupSeconds)
                : ["tcpquality-full", "nodequality-full"].includes(mod.module) ? mod.timeoutMinutes * 60
                : mod.module === "tcp-quality" ? 18 + 15 * (mod.packetSizes || []).length
                : ["international", "idc"].includes(mod.module)
                  ? 18 / 4
                  : 45),
          };
        }),
      })),
      exceedsCapacity: Object.values(capacity).some(
        (c) =>
          c.measurementsPerDay > 12000 ||
          c.estimatedLightSecondsPerDay > 86400 ||
          c.speedSecondsPerDay > 7200,
      ),
    };
  }
  function enqueue(s, suite, mod, nodeUuid, batchId, plannedAt, scheduled = false, stableId) {
    // One unfinished module round per suite/node. Repeated clicks do not duplicate traffic.
    const pending = native.pendingJobsFor ? native.pendingJobsFor(s, nodeUuid, suite.id, mod.module) : s.jobs.filter(
        (j) =>
          j.roundId &&
          j.nodeUuid === nodeUuid &&
          j.policyId === suite.id &&
          j.reportModule === mod.module,
      );
    const competing = ["tcpquality-full", "nodequality-full"].includes(mod.module) && s.jobs.some(j => j.nodeUuid === nodeUuid && j.reportModule === mod.module);
    if (pending.length && pending.some(j => j.roundId === stableId)) return stableId;
    if (pending.length && !["tcpquality-full", "nodequality-full"].includes(mod.module)) return scheduled && pending.some(j => j.expiresAt <= Date.now()) ? false : null;
    if (competing && !scheduled) return null;
    const roundId = stableId || crypto.randomUUID();
    const existing = stableId && store.get(nodeUuid, roundId, false);
    if (existing) {
      // Cursor persistence can lag a write-ahead manifest if the process exits.
      // Resume its original job IDs instead of issuing a duplicate measurement.
      const known = new Set(s.jobs.map(j => j.id));
      const recoverable = new Set([...known, ...(existing._jobs || []).map(job => job.id)]);
      const shared = new Map(s.jobs.filter(job => !job.sharedJobId).map(job => [measurementKey(job), job]));
      batch(() => {
        for (const job of existing._jobs || []) {
          if (known.has(job.id) || !existing.slots.some(slot => slot.jobId === job.id && !["ok", "partial", "application", "failed", "missing", "cancelled"].includes(slot.state))) continue;
          recoverJob(s, job, known, recoverable, shared);
          if (known.has(job.id)) store.progress(job);
        }
      });
      return existing.id;
    }
    const plan = R.planSlots(s, suite, mod, nodeUuid, roundId);
    if (competing) {
      // Record the scheduled occurrence rather than silently losing it or
      // running a second intrusive benchmark concurrently on the same VPS.
      const reason = "同一 VPS 的完整检测仍在运行或排队，本次计划已跳过";
      for (const job of plan.jobs) job.missingReason = reason;
      for (const slot of plan.slots) slot.missingReason = reason;
    }
    const active = plan.jobs.filter((j) => !readiness(s, j));
    if (s.jobs.length + active.length > MAX_QUEUE) {
      if (scheduled) return false;
      throw new Error("待测队列超过 10000 个目标，请减少 VPS 范围或分批启动");
    }
    const sharedJobs = new Map(
      s.jobs
        .filter((j) => j.roundId && !j.sharedJobId && j.nodeUuid === nodeUuid)
        .map((j) => [measurementKey(j), j]),
    );
    for (const job of active)
      shareJob(job, sharedJobs.get(measurementKey(job)), plannedAt);
    for (const job of plan.jobs) {
      if (scheduled && job.operation === "public-speed") job.availableAt = plannedAt + parseInt(crypto.createHash("sha256").update(nodeUuid).digest("hex").slice(0, 6), 16) % 120000;
    }
    // Persist sharing before queue state, so a restart cannot repeat the transfer.
    const round = store.create({
      id: roundId,
      nodeUuid,
      suiteId: suite.id,
      batchId,
      module: mod.module,
      plannedAt: new Date(plannedAt).toISOString(),
      parameters: mod,
      catalogVersion: VERSION,
      slots: plan.slots,
      _jobs: plan.jobs,
    });
    batch(() => { for (const job of plan.jobs) {
      job.reportModule = mod.module;
      const reason = readiness(s, job);
      if (reason)
        completeAndProject(job, {
          kind: R.kindFor(job.operation),
          state: "missing",
          diagnostic: reason,
        });
      else s.jobs.push(job);
    } });
    return round.id;
  }
  function dispatchRoundId(work, node) {
    const hash = crypto.createHash("sha256").update([work.batchId, work.suiteId, work.module, node].join("|")).digest("hex");
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  }
  function dispatchStep(s, options = {}) {
    const started = Date.now(), maxSteps = options.maxSteps || 2, maxMs = options.maxMs || 8;
    let steps = 0, changed = false;
    while (s.reportDispatch.length && steps++ < maxSteps && Date.now() - started < maxMs) {
      const work = s.reportDispatch[0], suite = s.reportSuites.find(p => p.id === work.suiteId && p.enabled);
      const mod = suite?.modules.find(m => m.module === work.module && m.enabled);
      if (!mod || work.cursor >= work.nodes.length) { s.reportDispatch.shift(); changed = true; continue; }
      const uuid = work.nodes[work.cursor], node = s.inventory.find(n => n.uuid === uuid);
      if (!node || (!suite.clients.includes(uuid) && !suite.groups.includes(node.group))) { work.cursor++; changed = true; continue; }
      const id = enqueue(s, suite, mod, uuid, work.batchId, work.plannedAt, true, dispatchRoundId(work, uuid));
      if (id === false) {
        // A full queue or an expired prior lease is temporary. Retain the exact
        // scheduled round and let the lease reaper / workers make progress.
        s.reportDispatch.push(s.reportDispatch.shift());
        break;
      }
      work.cursor++; changed = true;
      if (work.cursor >= work.nodes.length) s.reportDispatch.shift();
      else s.reportDispatch.push(s.reportDispatch.shift());
    }
    return changed;
  }
  function later(fn, delay) {
    const timer = setTimeout(fn, delay);
    if (typeof timer?.unref === "function") timer.unref();
    return timer;
  }
  function storageAlive() {
    try { fs.accessSync(ctx.storageDir); return true; }
    catch (error) {
      if (!ctx.isMissingFile(error, ctx.storageDir)) console.error("Aster storage unavailable:", String(error.message || error));
      return false;
    }
  }
  function scheduleDispatch() {
    if (dispatchTimer !== null) return;
    dispatchTimer = later(() => {
      dispatchTimer = null;
      if (!storageAlive()) return;
      void native.lock(() => {
        const started = Date.now();
        const s = state(native.read());
        if (dispatchStep(s)) native.save(s);
        recordSlice("dispatch", started);
        return s.reportDispatch.length > 0;
      }).then(pending => { if (pending) scheduleDispatch(); })
        // Leave the durable cursor for the next minute tick. A disk / malformed
        // report failure must not become a 500ms retry loop.
        .catch(error => console.error("Aster scheduled dispatch:", String(error.message || error)));
    }, 500);
  }
  function scheduleMaintenance() {
    if (maintenanceTimer !== null) return;
    maintenanceTimer = later(() => {
      maintenanceTimer = null;
      if (!storageAlive()) return;
      void native.lock(() => {
        const started = Date.now();
        const s = native.read();
        const result = store.maintenanceStep(s.inventory.map(node => node.uuid), { maxSteps: 32, maxMs: 8,
          isRoundActive: (node, id) => native.isRoundActive ? native.isRoundActive(s, node, id) : s.jobs.some(job => job.nodeUuid === node && job.roundId === id),
        });
        recordSlice("maintenance", started);
        performance.maintenance.steps += result.steps;
        performance.maintenance.pending = result.pending;
        performance.maintenance.nextAt = result.nextAt;
        return result;
      }).then(result => { if (result.pending) scheduleMaintenance(); })
        .catch(error => console.error("Aster report maintenance:", String(error.message || error)));
    }, 500);
  }
  function storedJobResult(node, id, jobId) {
    const round = store.get(node, id, false), slot = round?.slots.find(value => value.jobId === jobId);
    return slot ? store.measurement(node, id, slot.id) : null;
  }
  function recoverJob(s, job, knownIds, recoverableIds, sharedJobs) {
    if (knownIds.has(job.id)) return;
    // A shared leader can finish after the follower manifest was written but
    // before its queue/cursor checkpoint. Reuse that durable result first.
    if (job.sharedJobId && job.sharedRoundId) {
      const result = storedJobResult(job.nodeUuid, job.sharedRoundId, job.sharedJobId);
      if (result && result.data.state !== "cancelled") {
        completeAndProject(job, { ...result.data, sharedMeasurementId: result.id }, result.source);
        return;
      }
    }
    const reason = readiness(s, job);
    if (reason || job.expiresAt <= Date.now()) {
      completeAndProject(job, {kind:R.kindFor(job.operation),state:"missing",diagnostic:reason || "恢复时任务已超过排队期限"});
      return;
    }
    if (!job.sharedJobId || !recoverableIds.has(job.sharedJobId)) {
      delete job.sharedJobId; delete job.sharedRoundId; delete job.waitReason;
      // Keep an already acknowledged lease. Queued/orphan shared work may be
      // reattached, but must never wait for an owner that no longer exists.
      if (!["running", "provider", "bgp-running"].includes(job.phase)) job.phase = "queued";
      if (job.phase === "queued") shareJob(job, sharedJobs.get(measurementKey(job)), job.plannedAt || job.queuedAt);
    }
    s.jobs.push(job); knownIds.add(job.id);
    if (!job.sharedJobId) sharedJobs.set(measurementKey(job), job);
  }
  function previousRouteMeasurement(job, source, id) {
    const result = store.measurement(job.nodeUuid, id, job.slotId), origin = source || job.source;
    if (!result || result.target !== job.target || result.options.family !== job.options.family || result.options.protocol !== job.options.protocol) return null;
    return JSON.stringify([result.source.provider, result.source.id || result.source.probeId || "", result.source.city, result.source.asn]) ===
      JSON.stringify([origin.provider, origin.id || origin.probeId || "", origin.city, origin.asn]) ? result : null;
  }
  function rebuildHomeRoutes(uuids, force = false) {
    let enqueued = false;
    for (const uuid of uuids) {
      if (routeHistoryQueue.has(uuid) || (!force && homeRoutes.isHistoryRecovered(uuid))) continue;
      routeHistoryQueue.set(uuid, { uuid, cursor: "", rows: [], nextCursor: "", round: null, slot: 0 });
      enqueued = true;
    }
    if (enqueued && Date.now() >= routeHistoryRetryAt) drainRouteHistory();
    else if (routeHistoryQueue.size) scheduleRouteHistory();
    else if (native.read().homeRouteProjectionVersion !== 3) drainRouteHistory();
  }
  function scheduleRouteHistory() {
    if (!routeHistoryQueue.size || routeHistoryTimer !== null) return;
    let firstReady = Infinity;
    for (const work of routeHistoryQueue.values()) firstReady = Math.min(firstReady, work.retryAt || 0);
    routeHistoryTimer = later(() => {
      routeHistoryTimer = null;
      if (!storageAlive()) return;
      void native.lock(drainRouteHistory).catch(error => {
        routeHistoryRetryAt = Date.now() + 60000;
        console.error("Aster route recovery:", String(error.message || error));
        scheduleRouteHistory();
      });
    }, Math.max(500, routeHistoryRetryAt - Date.now(), firstReady - Date.now()));
  }
  function drainRouteHistory() {
    const started = Date.now(); let steps = 0, deferred = 0;
    if (started < routeHistoryRetryAt) { scheduleRouteHistory(); return; }
    while (routeHistoryQueue.size && steps++ < 32 && Date.now() - started < 8) {
      const work = routeHistoryQueue.values().next().value;
      if (work.retryAt > Date.now()) {
        routeHistoryQueue.delete(work.uuid); routeHistoryQueue.set(work.uuid, work);
        if (++deferred >= routeHistoryQueue.size) break;
        continue;
      }
      deferred = 0;
      try {
        if (work.finished && !work.round) {
          homeRoutes.markHistoryRecovered(work.uuid); routeHistoryQueue.delete(work.uuid); continue;
        }
        if (work.round) {
          const slot = work.round.slots[work.slot];
          if (slot) {
            const measurement = store.measurement(work.uuid, work.round.id, slot.id);
            if (measurement) homeRoutes.observe(measurement, false);
            work.slot++;
          }
          if (!slot || work.slot >= work.round.slots.length) { work.round = null; work.slot = 0; }
        } else {
          if (!work.rows.length) {
            const page = store.list(work.uuid, "routes", {limit:50,cursor:work.cursor});
            work.rows = page.rounds.slice(); work.nextCursor = page.nextCursor;
          }
          const row = work.rows[0];
          if (!row) {
            homeRoutes.markHistoryRecovered(work.uuid); routeHistoryQueue.delete(work.uuid); continue;
          }
          if (row.detailAvailable && (!row.completedAt || Date.now() - Date.parse(row.completedAt) <= 7 * 86400000)) work.round = store.get(work.uuid, row.id, false);
          work.rows.shift();
          if (!work.rows.length) {
            if (work.nextCursor) work.cursor = work.nextCursor;
            else work.finished = true;
          }
        }
        if (work.finished && !work.round) {
          homeRoutes.markHistoryRecovered(work.uuid); routeHistoryQueue.delete(work.uuid);
        } else { routeHistoryQueue.delete(work.uuid); routeHistoryQueue.set(work.uuid, work); }
      } catch (error) {
        // Keep both the UUID and its exact row/slot cursor. Explicit rebuilds
        // also need retries even if a previous projection was already complete.
        routeHistoryQueue.delete(work.uuid); routeHistoryQueue.set(work.uuid, work);
        work.retryAt = Date.now() + 60000;
        console.error("Aster route history recovery:", String(error.message || error));
      }
    }
    homeRoutes.save();
    const s = native.read();
    if (s.homeRouteProjectionVersion !== 3 && s.inventory.length && s.inventory.every(node => homeRoutes.isHistoryRecovered(node.uuid))) {
      s.homeRouteProjectionVersion = 3; native.save(s);
    }
    scheduleRouteHistory();
  }
  function homePayload(s, uuids, admin = false) {
    const nodes = homeRoutes.summary(uuids);
    // Tool diagnostics can contain private endpoint addresses; only admins receive them.
    if (!admin) for (const uuid of Object.keys(nodes)) nodes[uuid] = Object.fromEntries(Object.entries(nodes[uuid]).map(([family, rows]) => [family,
      rows.map(row => ({ ...row, forward: row.forward ? { ...row.forward, diagnostic: "" } : null,
        return: row.return ? { ...row.return, diagnostic: "" } : null }))]));
    return { available: true, nodes, access: admin ? "admin" : "public",
      backfillPending: admin && uuids.some(uuid => routeHistoryQueue.has(uuid)),
      labelMode: s.homeRouteLabelMode || "preferred", showDetails: s.homeRouteShowDetails === true,
      published: uuids.filter(id => (s.homeRouteNodes || []).includes(id)), display: s.homeRouteDisplay !== false };
  }
  route("GET", "/home-routes", (_req, res, s) => {
    const ids = s.inventory.map(n => n.uuid);
    // Rebuild once after upgrading the projection, using only retained v3 rounds.
    if (s.homeRouteProjectionVersion !== 3) {
      rebuildHomeRoutes(ids);
    }
    ctx.respond(res, 200, { ...homePayload(s, ids, true), quickCheck: true, quickFamilies: cardFamilies(s, "routes") });
  });
  route("POST", "/home-routes/rebuild", (_req, res, s) => {
    rebuildHomeRoutes(s.inventory.map(n => n.uuid), true);
    ctx.respond(res, 200, homePayload(s, s.inventory.map(n => n.uuid), true));
  });
  // Explicit per-node publication; old installations publish nothing by default.
  route("PUT", "/home-routes", (req, res, s) => {
    const body = ctx.readBody(req);
    if (body.revision !== s.revision) { ctx.respond(res, 409, { error: "配置已变化，请刷新后保存" }); return; }
    if (body.labelMode !== undefined && !["preferred", "full"].includes(body.labelMode)) throw new Error("线路展示方式无效");
    if (body.showDetails !== undefined && typeof body.showDetails !== "boolean") throw new Error("线路说明开关无效");
    if (!Array.isArray(body.nodeUuids) || body.nodeUuids.length > 2000 || body.nodeUuids.some(id => !UUID.test(id))) throw new Error("节点范围无效");
    const allowed = new Set(s.inventory.filter(n => n.publicVisible === true).map(n => n.uuid));
    const selected = [...new Set(body.nodeUuids)];
    if (selected.some(id => !allowed.has(id))) throw new Error("只能发布当前可见节点的线路摘要，请刷新清单");
    // Display preferences read the existing projection. Only newly published
    // nodes need historical backfill; explicit rebuild remains available.
    rebuildHomeRoutes(selected.filter(id => !(s.homeRouteNodes || []).includes(id)));
    s.homeRouteNodes = selected;
    if (typeof body.display === "boolean") s.homeRouteDisplay = body.display;
    if (body.labelMode !== undefined) s.homeRouteLabelMode = body.labelMode;
    if (body.showDetails !== undefined) s.homeRouteShowDetails = body.showDetails;
    s.revision++;
    native.save(s);
    ctx.respond(res, 200, { revision: s.revision });
  });
  ctx.server.route("GET", BASE + "/public/routes", async (_req, res) => {
    try {
      await native.lock(() => {
        const s = native.read();
        // Cached inventory must have been refreshed by this plugin version. Fail closed.
        const visible = new Set(s.inventory.filter(n => n.publicVisible === true).map(n => n.uuid));
        const allowed = (s.homeRouteNodes || []).filter(id => visible.has(id));
        ctx.respond(res, 200, homePayload(s, allowed));
      });
    } catch (_error) { ctx.respond(res, 503, { error: "线路摘要暂不可用" }); }
  });
  function rebuildHomeSpeeds(uuids, force = false) {
    let enqueued = false;
    for (const uuid of uuids) {
      if (!force && (speedHistoryChecked.has(uuid) || speedHistoryQueue.has(uuid) || homeSpeeds.isHistoryRecovered(uuid))) continue;
      speedHistoryQueue.set(uuid, { uuid, cursor: "", rows: [], nextCursor: "", best: {}, force });
      enqueued = true;
    }
    if (enqueued) drainSpeedHistory();
  }
  function drainSpeedHistory() {
    const started = Date.now();
    let steps = 0;
    // Old indexes lack family metadata. Recover in short batches so one large
    // history cannot monopolize the worker-state lock or the Goja interpreter.
    while (speedHistoryQueue.size && steps++ < 64 && Date.now() - started < 20) {
      const work = speedHistoryQueue.values().next().value;
      try {
        if (!work.rows.length) {
          const page = store.list(work.uuid, "china-speed", { limit: 50, cursor: work.cursor });
          work.rows = page.rounds.slice(); work.nextCursor = page.nextCursor;
        }
        const row = work.rows.shift();
        const bothOlder = row && work.best["4"] && work.best["6"] &&
          row.plannedAt < work.best["4"].plannedAt && row.plannedAt < work.best["6"].plannedAt;
        if (row && !bothOlder && row.completedAt &&
            !(work.best[row.family] && row.plannedAt < work.best[row.family].plannedAt)) {
          const round = store.get(work.uuid, row.id, false), family = round?.parameters?.family;
          const key = value => [value.plannedAt, value.completedAt, value.id].join("|");
          if (round?.completedAt && ["4", "6"].includes(family) &&
              (!work.best[family] || key(round) > key(work.best[family]))) {
            work.best[family] = round; homeSpeeds.observe(round, work.force);
          }
        }
        if (bothOlder || !row || (!work.rows.length && !work.nextCursor)) {
          homeSpeeds.markHistoryRecovered(work.uuid);
          speedHistoryChecked.add(work.uuid); speedHistoryQueue.delete(work.uuid);
        } else {
          if (!work.rows.length) work.cursor = work.nextCursor;
          speedHistoryQueue.delete(work.uuid); speedHistoryQueue.set(work.uuid, work);
        }
      } catch (error) {
        speedHistoryQueue.delete(work.uuid);
        console.error("Aster homepage speed recovery:", String(error.message || error));
      }
    }
    if (speedHistoryQueue.size && speedHistoryTimer === null) speedHistoryTimer = setTimeout(() => {
      speedHistoryTimer = null;
      void native.lock(drainSpeedHistory).catch(error => console.error("Aster speed recovery:", String(error.message || error)));
    }, 500);
  }
  function speedPayload(s, ids, admin, splitFamilies = false) {
    return { available: true, nodes: homeSpeeds.summary(ids, splitFamilies),
      showDetails: s.homeSpeedShowDetails === true,
      backfillPending: admin && ids.some(id => speedHistoryQueue.has(id)),
      access: admin ? "admin" : "public", display: s.homeSpeedDisplay !== false,
      published: ids.filter(id => (s.homeSpeedNodes || []).includes(id)) };
  }
  route("GET", "/home-speeds", (req, res, s) => {
    const ids = s.inventory.map(n => n.uuid);
    rebuildHomeSpeeds(ids);
    ctx.respond(res, 200, { ...speedPayload(s, ids, true, query(req, "families") === "1"), quickCheck: true, quickFamilies: cardFamilies(s, "china-speed") });
  });
  route("POST", "/home-speeds/rebuild", (req, res, s) => {
    const ids = s.inventory.map(n => n.uuid);
    rebuildHomeSpeeds(ids, true);
    ctx.respond(res, 200, speedPayload(s, ids, true, query(req, "families") === "1"));
  });
  route("PUT", "/home-speeds", (req, res, s) => {
    const body = ctx.readBody(req);
    if (body.revision !== s.revision) { ctx.respond(res, 409, { error: "配置已变化，请刷新后保存" }); return; }
    if (body.showDetails !== undefined && typeof body.showDetails !== "boolean") throw new Error("测速说明开关无效");
    if (!Array.isArray(body.nodeUuids) || body.nodeUuids.length > 2000 || body.nodeUuids.some(id => !UUID.test(id))) throw new Error("节点范围无效");
    const visible = new Set(s.inventory.filter(n => n.publicVisible === true).map(n => n.uuid));
    const selected = [...new Set(body.nodeUuids)];
    if (selected.some(id => !visible.has(id))) throw new Error("只能发布当前可见节点的测速摘要，请刷新清单");
    rebuildHomeSpeeds(selected);
    s.homeSpeedNodes = selected;
    if (typeof body.display === "boolean") s.homeSpeedDisplay = body.display;
    if (body.showDetails !== undefined) s.homeSpeedShowDetails = body.showDetails;
    s.revision++; native.save(s);
    ctx.respond(res, 200, { revision: s.revision });
  });
  ctx.server.route("GET", BASE + "/public/speeds", async (req, res) => {
    try {
      await native.lock(() => {
        const s = native.read(), visible = new Set(s.inventory.filter(n => n.publicVisible === true).map(n => n.uuid));
        const ids = (s.homeSpeedNodes || []).filter(id => visible.has(id));
        ctx.respond(res, 200, speedPayload(s, ids, false, query(req, "families") === "1"));
      });
    } catch (_error) { ctx.respond(res, 503, { error: "测速摘要暂不可用" }); }
  });
  route("GET", "/capabilities", (_req, res) =>
    ctx.respond(res, 200, capabilities),
  );
  route("GET", "/performance", (_req, res, s) => {
    ctx.respond(res, 200, { ...performance, queuedJobs: s.jobs.length,
      pendingBatches: s.reportDispatch.length,
      pendingNodes: s.reportDispatch.reduce((total, work) => total + Math.max(0, work.nodes.length - work.cursor), 0),
      limits: { dispatchNodes: 2, dispatchMs: 8, maintenanceSteps: 32, maintenanceMs: 8, gapMs: 500 },
    });
  });
  route("GET", "/catalog", (_req, res, s) => {
    void native.catalogTick();
    ctx.respond(res, 200, {
      ...capabilities,
      catalogVersion: VERSION,
      endpoints: R.directory(s),
      presets: PRESETS,
      suites: s.reportSuites,
      homeRouteNodes: s.homeRouteNodes || [],
      homeRouteDisplay: s.homeRouteDisplay !== false,
      homeRouteLabelMode: s.homeRouteLabelMode || "preferred",
      homeRouteShowDetails: s.homeRouteShowDetails === true,
      homeSpeedNodes: s.homeSpeedNodes || [],
      homeSpeedDisplay: s.homeSpeedDisplay !== false,
      homeSpeedShowDetails: s.homeSpeedShowDetails === true,
      revision: s.revision,
      inventory: s.inventory,
      timezones: M.TIMEZONES,
      probes: Object.entries(s.probes).map(([id, p]) => {
        const { tokenHash: _hash, ...safe } = p;
        return { ...safe, id, online: native.online(s, "probe:" + id) };
      }),
    });
  });
  route("POST", "/resources", (req, res, s) => {
    const body = ctx.readBody(req);
    if (body.revision !== s.revision) {
      ctx.respond(res, 409, { error: "配置已变化，请刷新后保存" });
      return;
    }
    const resource = require("./report-resources.js").normalizeResource(body);
    if (
      resource.method === "http" &&
      resource.https === false &&
      (body.token || (!body.clearToken && s.reportSecrets?.[resource.id]))
    )
      throw new Error("带密钥的 HTTP 测速资源必须使用 HTTPS，避免明文传输凭证");
    if (
      s.reportResources.length >= 100 &&
      !s.reportResources.some((e) => e.id === resource.id)
    )
      throw new Error("自定义资源已达 100 个");
    if (
      body.token !== undefined &&
      (typeof body.token !== "string" ||
        body.token.length > 512 ||
        (body.token &&
          (body.token.length < 32 || /[^\x21-\x7e]/.test(body.token))))
    )
      throw new Error("资源密钥需为 32–512 个可见 ASCII 字符");
    s.reportResources = [
      ...s.reportResources.filter((e) => e.id !== resource.id),
      resource,
    ];
    s.reportSecrets ||= {};
    if (body.token) s.reportSecrets[resource.id] = body.token;
    if (body.clearToken === true) delete s.reportSecrets[resource.id];
    s.revision++;
    native.save(s);
    ctx.respond(res, 200, { resource, revision: s.revision });
  });
  route("DELETE", "/resources/:id", (req, res, s) => {
    const id = part(req, 2);
    if (
      s.reportSuites.some((p) =>
        p.modules.some((m) => m.endpoints.includes(id)),
      )
    )
      throw new Error("请先从所有方案中移除此资源，再删除");
    s.reportResources = s.reportResources.filter((e) => e.id !== id);
    if (s.reportSecrets) delete s.reportSecrets[id];
    s.revision++;
    native.save(s);
    ctx.respond(res, 200, { revision: s.revision });
  });
  route("POST", "/preview", (req, res, s) =>
    ctx.respond(
      res,
      200,
      preview(s, R.normalizeSuite(ctx.readBody(req), s.reportResources)),
    ),
  );
  route("POST", "/suites", (req, res, s) => {
    const body = ctx.readBody(req);
    if (body.revision !== s.revision) {
      ctx.respond(res, 409, { error: "配置已变化，请刷新后保存" });
      return;
    }
    const suite = R.normalizeSuite(body, s.reportResources);
    if (preview(s, suite).exceedsCapacity)
      throw new Error("整台 VPS 的累计计划超过采集容量，请减少目标或降低频率");
    if (!suite.inherit) {
      suite.clients = M.members(suite, s.inventory);
      suite.groups = [];
    }
    if (suite.modules.some((m) => m.sources.some((id) => !s.probes[id])))
      throw new Error("选中的测量点不存在");
    const memberIds = new Set(M.members(suite, s.inventory));
    for (const job of s.jobs.filter(
      (j) =>
        j.roundId &&
        j.policyId === suite.id &&
        (!suite.enabled ||
          !memberIds.has(j.nodeUuid) ||
          !suite.modules.some((m) => m.enabled && m.module === j.reportModule)),
    ))
      native.finish(s, job, {
        kind: R.kindFor(job.operation),
        state: "cancelled",
        diagnostic: "本轮所属计划或模块已停用，或 VPS 已移出范围",
      });
    const old = s.reportSuites.find((p) => p.id === suite.id);
    // Editing a plan invalidates only its not-yet-dispatched members. Active
    // measurements still follow the cancellation rules above.
    s.reportDispatch = s.reportDispatch.filter(work => work.suiteId !== suite.id);
    if (old) Object.assign(old, suite);
    else {
      if (s.reportSuites.length >= 100)
        throw new Error("报告方案达到 100 个上限");
      s.reportSuites.push(suite);
    }
    s.revision++;
    native.save(s);
    ctx.respond(res, 200, { suite, revision: s.revision });
  });
  route("POST", "/suites/:id/run", (req, res, s) => {
    const suite = s.reportSuites.find((p) => p.id === part(req, 2));
    if (!suite || !suite.enabled) throw new Error("报告方案不存在或已停用");
    const body = ctx.readBody(req), selected = body.module;
    const scope = members(suite, s);
    if (body.nodeUuids !== undefined && (!Array.isArray(body.nodeUuids) || !body.nodeUuids.length || body.nodeUuids.some(id => !scope.some(n => n.uuid === id)))) throw new Error("执行范围必须属于此方案");
    if (selected && !MODULES.includes(selected))
      throw new Error("报告模块无效");
    const batchId = crypto.randomUUID(),
      rounds = [];
    for (const node of scope.filter(n => !body.nodeUuids || body.nodeUuids.includes(n.uuid)))
      for (const mod of suite.modules.filter(
        (m) => m.enabled && (!selected || m.module === selected),
      )) {
        const pending = s.reportDispatch.find(work => work.suiteId === suite.id && work.module === mod.module && work.nodes.slice(work.cursor).includes(node.uuid));
        const id = enqueue(s, suite, mod, node.uuid, pending?.batchId || batchId, pending?.plannedAt || Date.now(), false, pending ? dispatchRoundId(pending, node.uuid) : undefined);
        if (id) rounds.push(id);
      }
    native.save(s);
    ctx.respond(res, 202, { batchId, rounds });
  });
  route("DELETE", "/suites/:id", (req, res, s) => {
    const id = part(req, 2);
    for (const job of s.jobs.filter((j) => j.roundId && j.policyId === id))
      native.finish(s, job, {
        kind: R.kindFor(job.operation),
        state: "cancelled",
        diagnostic: "报告方案已删除",
      });
    s.reportSuites = s.reportSuites.filter((p) => p.id !== id);
    s.reportDispatch = s.reportDispatch.filter(work => work.suiteId !== id);
    s.revision++;
    native.save(s);
    ctx.respond(res, 200, { revision: s.revision });
  });
  route("GET", "/nodes/:uuid/rounds", (req, res) => {
    ctx.respond(
      res,
      200,
      store.list(part(req, 2), query(req, "module") || "international", {
        limit: query(req, "limit"),
        cursor: query(req, "cursor"),
      }),
    );
  });
  // Bounded, authenticated history pages recover per-target summaries after
  // raw measurement files expire. They do not load the measurement files.
  route("GET", "/nodes/:uuid/history-summary", (req, res) => {
    const uuid = part(req, 2), module = query(req, "module") || "international";
    const page = store.list(uuid, module, { limit: Math.min(20, Number(query(req, "limit")) || 20), cursor: query(req, "cursor") });
    const rounds = page.rounds.map(row => {
      if (row.detailAvailable !== false) return row;
      const round = store.get(uuid, row.id, false);
      return { ...row, slots: (round?.slots || []).map(slot => ({
        id: slot.id, state: slot.state, completedAt: slot.completedAt, target: slot.target, direction: slot.direction,
        source: { id: slot.source?.id, city: slot.source?.city, carrier: slot.source?.carrier, provider: slot.source?.provider, name: slot.source?.name },
        options: { protocol: slot.options?.protocol }, metrics: slot.metrics,
      })) };
    });
    ctx.respond(res, 200, { ...page, rounds });
  });
  route("GET", "/nodes/:uuid/rounds/:id", (req, res) => {
    const result = store.get(part(req, 2), part(req, 4));
    ctx.respond(
      res,
      result ? 200 : 404,
      result || { error: "轮次不存在或已超过保留期" },
    );
  });
  route("DELETE", "/nodes/:uuid/rounds/:id", (req, res, s) => {
    const node = part(req, 2), id = part(req, 4);
    if (!UUID.test(node || "") || !UUID.test(id || "")) throw new Error("报告标识无效");
    if (native.isRoundActive(s, node, id)) throw new Error("检测仍在进行，请先取消");
    if (!store.deleteFullRound(node, id)) { ctx.respond(res, 404, { error: "报告不存在" }); return; }
    ctx.respond(res, 200, { ok: true });
  });
  route("POST", "/nodes/:uuid/rounds/:id/share", (req, res, s) => {
    const nodeUuid = part(req, 2),
      roundId = part(req, 4),
      round = store.get(nodeUuid, roundId);
    if (!round || round.detailAvailable === false || round.state === "running")
      throw new Error("只能分享明细未过期且已收尾的报告");
    s.reportShares ||= {};
    for (const id of Object.keys(s.reportShares))
      if (s.reportShares[id].expiresAt <= Date.now()) delete s.reportShares[id];
    if (Object.keys(s.reportShares).length >= 1000)
      throw new Error("分享数量达到 1000 个，请先撤销旧分享");
    const token = crypto.randomBytes(32).toString("hex"),
      id = crypto.createHash("sha256").update(token).digest("hex");
    s.reportShares[id] = {
      nodeUuid,
      roundId,
      expiresAt: Math.min(
        Date.now() + 7 * 86400000,
        Date.parse(round.completedAt) + 7 * 86400000,
      ),
    };
    native.save(s);
    ctx.respond(res, 200, {
      id,
      expiresAt: s.reportShares[id].expiresAt,
      url: BASE + "/shares/" + token,
    });
  });
  route("DELETE", "/nodes/:uuid/rounds/:id/shares", (req, res, s) => {
    const nodeUuid = part(req, 2),
      roundId = part(req, 4);
    for (const id of Object.keys(s.reportShares || {}))
      if (
        s.reportShares[id].nodeUuid === nodeUuid &&
        s.reportShares[id].roundId === roundId
      )
        delete s.reportShares[id];
    native.save(s);
    ctx.respond(res, 200, { ok: true });
  });
  ctx.server.route("GET", BASE + "/shares/:token", async (req, res) => {
    try {
      await native.lock(() => {
        const token = part(req, 2);
        const entry = /^[a-f0-9]{64}$/.test(token)
          ? native.read().reportShares?.[
              crypto.createHash("sha256").update(token).digest("hex")
            ]
          : null;
        if (!entry || entry.expiresAt <= Date.now()) {
          ctx.respond(res, 404, { error: "分享已到期或撤销" });
          return;
        }
        const round = store.get(entry.nodeUuid, entry.roundId);
        if (!round || round.detailAvailable === false) {
          ctx.respond(res, 404, { error: "报告明细已过期" });
          return;
        }
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("X-Robots-Tag", "noindex, nofollow");
        res.setHeader("X-Content-Type-Options", "nosniff");
        if (query(req, "format") === "json") {
          ctx.respond(res, 200, round);
          return;
        }
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        );
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.statusCode = 200;
        res.end(
          require("./report-share.js").html(
            round,
            entry.expiresAt,
            BASE + "/shares/" + token + "?format=json",
          ),
        );
      });
    } catch (e) {
      ctx.respond(res, 400, { error: String(e.message || e) });
    }
  });
  route("POST", "/nodes/:uuid/rounds/:id/cancel", (req, res, s) => {
    const node = part(req, 2),
      id = part(req, 4);
    if (!UUID.test(node) || !UUID.test(id)) throw new Error("轮次 UUID 无效");
    if (!store.get(node, id, false)) {
      ctx.respond(res, 404, { error: "轮次不存在" });
      return;
    }
    for (const job of s.jobs.filter(
      (j) => j.nodeUuid === node && j.roundId === id,
    ))
      native.finish(s, job, {
        kind: R.kindFor(job.operation),
        state: "cancelled",
        diagnostic: "管理员已取消本轮检测",
      });
    native.save(s);
    ctx.respond(res, 200, { ok: true });
  });
  function tick(s) {
    state(s);
    const now = Date.now();
    let changed = false;
    if (s.homeRouteProjectionVersion !== 3 && s.inventory.length) {
      rebuildHomeRoutes(s.inventory.map(n => n.uuid));
    }
    if (!recovered && s.inventory.length) {
      const pending = s.inventory.flatMap((node) => store.pending(node.uuid));
      if (pending.length) changed = true;
      const knownIds = new Set(s.jobs.map((j) => j.id));
      const recoverableIds = new Set([
        ...knownIds,
        ...pending.map((j) => j.id),
      ]);
      const sharedJobs = new Map(
        s.jobs
          .filter((j) => j.roundId && !j.sharedJobId)
          .map((j) => [measurementKey(j), j]),
      );
      batch(() => {
      for (const job of pending) {
        if (knownIds.has(job.id)) continue;
        recoverJob(s, job, knownIds, recoverableIds, sharedJobs);
        if (knownIds.has(job.id)) store.progress(job);
      }
      for (const follower of s.jobs.filter(
        (j) => j.sharedJobId && !knownIds.has(j.sharedJobId),
      )) {
        changed = true;
        const result = storedJobResult(follower.nodeUuid, follower.sharedRoundId, follower.sharedJobId);
        if (result && result.data.state !== "cancelled")
          native.finish(
            s,
            follower,
            { ...result.data, sharedMeasurementId: result.id },
            result.source,
          );
        else {
          delete follower.sharedJobId;
          delete follower.sharedRoundId;
          delete follower.waitReason;
          follower.phase = "queued";
          native.touchJob?.(follower);
          store.progress(follower);
        }
      }
      });
      recovered = true;
    }
    for (const suite of s.reportSuites.filter((p) => p.enabled))
      for (const mod of suite.modules.filter(
        (m) => m.enabled && m.nextAt <= now,
      )) {
        if (!s.reportDispatch.some(work => work.suiteId === suite.id && work.module === mod.module && work.plannedAt === mod.nextAt)) {
          s.reportDispatch.push({ suiteId: suite.id, module: mod.module, batchId: crypto.randomUUID(),
            plannedAt: mod.nextAt, nodes: members(suite, s).map(node => node.uuid), cursor: 0 });
        }
        mod.nextAt = M.next(mod.timing, now);
        changed = true;
      }
    if (s.reportDispatch.length) scheduleDispatch();
    // Retention uses its own resumable cursor and expiry deadlines. Never scan
    // all nodes/history/receipts synchronously inside the hourly scheduler.
    scheduleMaintenance();
    return changed;
  }
  async function publicTick() {
    if (bgpBusy) return;
    bgpBusy = true;
    try {
      // A function-scoped binding avoids Goja stash corruption when an
      // awaited value is declared inside try (Komari 1.4.3 and 1.5.1).
      var job = await native.lock(() => {
        const s = native.read(),
          candidate = s.jobs.find(
            (j) =>
              j.operation === "bgp" &&
              ["queued", "bgp-running"].includes(j.phase),
          );
        if (!candidate) return null;
        candidate.phase = "bgp-running";
        candidate.startedAt ||= new Date().toISOString();
        candidate.expiresAt = Date.now() + 120000;
        native.touchJob?.(candidate);
        store.progress(candidate);
        native.save(s, false, true);
        return { ...candidate };
      });
      if (!job) return;
      var data;
      try {
        data = await bgp.collect(job.target);
      } catch (e) {
        data = {
          kind: "bgp",
          state: "failed",
          diagnostic: String(e.message || e),
        };
      }
      await native.lock(() => {
        const s = native.read(),
          current = s.jobs.find((j) => j.id === job.id);
        if (!current) return; // Cancellation won; never resurrect its result.
        if (data.prefix) {
          const recent = store
            .list(job.nodeUuid, "bgp")
            .rounds.find(
              (r) =>
                r.id !== job.roundId &&
                r.detailAvailable &&
                ["complete", "partial"].includes(r.state),
            );
          const previous = recent
            ? store.get(job.nodeUuid, recent.id)?.measurements[0]?.data
            : null;
          data = {
            ...data,
            changes: B.changes(previous, data),
            previousRoundId: recent?.id || null,
          };
        }
        native.finish(s, current, data);
        native.save(s, false, true);
      });
    } finally {
      bgpBusy = false;
    }
  }
  return {
    store,
    tick,
    batch,
    dispatchStep,
    recoverRoutesStep: drainRouteHistory,
    publicTick,
    preview,
    enqueue,
    complete: (job, data, source) => {
      if (data.kind === "route" && data.hops?.length) {
        const recent = store
          .list(job.nodeUuid, "routes")
          .rounds.find(
            (r) =>
              r.id !== job.roundId &&
              r.detailAvailable &&
              ["complete", "partial"].includes(r.state),
          );
        const old = recent ? previousRouteMeasurement(job, source, recent.id) : null;
        const observed = (hops) =>
          hops
            .map((h) => h.asn || "?")
            .filter((v, i, all) => i === 0 || all[i - 1] !== v);
        data = {
          ...data,
          routeChange: {
            comparable: !!old,
            previousRoundId: old?.roundId || null,
            previousCompletedAt: old?.completedAt || null,
            observedAsPathChanged: old
              ? JSON.stringify(observed(old.data.hops || [])) !==
                JSON.stringify(observed(data.hops))
              : null,
            previousAsPath: old ? observed(old.data.hops || []) : [],
            currentAsPath: observed(data.hops),
            conditions:
              "同目标、地址族、协议与来源身份的相邻观测；缺跳/ECMP/公共测量点变化会影响比较，不等同于业务路由已变更",
          },
        };
      }
      return completeAndProject(job, data, source);
    },
    progress: (job) => store.progress(job),
    receipt: store.receipt,
    acceptLateFull: store.acceptLateFull,
    updateFullReportUrl: store.updateFullReportUrl,
    capabilities,
  };
}
module.exports = { registerReportController, BASE, MAX_QUEUE };
