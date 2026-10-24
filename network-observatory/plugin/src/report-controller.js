const crypto = require("crypto");
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
  let recovered = false;
  let bgpBusy = false;
  const capabilities = {
    schema: 3,
    features: [
      "rounds",
      "latency-samples",
      "full-mtr",
      "bgp-rpki",
      "speed-intervals",
      "http-speed", "tcp-quality", "public-speed",
    ],
    modules: MODULES,
    maxTargetsPerRound: 250,
    retention: { detailDays: 7, summaryDays: 90 },
  };
  function completeAndProject(job, data, source) {
    if (data.kind === "route") data = { ...data, routeEvidence: require("./route-evidence.js").routeFacts(data.hops || []) };
    const result = store.complete(job, data, source);
    if (result) {
      try { homeRoutes.observe(result); }
      catch (e) { console.error("Aster homepage route projection:", String(e.message || e)); }
      if (data.kind === "speed") {
        try {
          const round = store.get(job.nodeUuid, job.roundId, false);
          if (round?.module === "china-speed" && round.completedAt) homeSpeeds.observe(round);
        } catch (e) { console.error("Aster homepage speed projection:", String(e.message || e)); }
      }
    }
    return result;
  }
  function state(s) {
    s.reportSuites ||= [];
    s.reportResources ||= [];
    return s;
  }
  function members(suite, s) {
    const ids = new Set(M.members(suite, s.inventory));
    return s.inventory.filter((node) => ids.has(node.uuid));
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
  function readiness(s, job, previewOnly = false) {
    if (job.missingReason) return job.missingReason;
    if (job.executor === "bgp")
      return originQuery(job.target)
        ? ""
        : "BGP 快照需要 VPS 的公网 IP；域名、私网与保留地址不作为路由证据";
    if (job.executor === "globalping")
      return previewOnly ? native.coverage(s, job) : ""; // Discovery at execution occurs outside the state lock.
    if (
      !["latency", "route", "benchmark", "http-speed", "iperf-speed", "public-speed", "tcp-quality"].includes(
        job.operation,
      )
    )
      return "当前采集器未提供此测量操作";
    const required = ["tcp-quality", "public-speed"].includes(job.operation) ? job.operation :
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
          const times =
            mod.timing.type === "daily"
              ? mod.timing.times.length
              : 1440 / mod.timing.minutes;
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
  function enqueue(s, suite, mod, nodeUuid, batchId, plannedAt, scheduled = false) {
    // One unfinished module round per suite/node. Repeated clicks do not duplicate traffic.
    if (
      s.jobs.some(
        (j) =>
          j.roundId &&
          j.nodeUuid === nodeUuid &&
          j.policyId === suite.id &&
          j.reportModule === mod.module,
      )
    )
      return null;
    const roundId = crypto.randomUUID(),
      plan = R.planSlots(s, suite, mod, nodeUuid, roundId);
    const active = plan.jobs.filter((j) => !readiness(s, j));
    if (s.jobs.length + active.length > MAX_QUEUE)
      throw new Error("待测队列超过 10000 个目标，请减少 VPS 范围或分批启动");
    const sharedJobs = new Map(
      s.jobs
        .filter((j) => j.roundId && !j.sharedJobId && j.nodeUuid === nodeUuid)
        .map((j) => [measurementKey(j), j]),
    );
    for (const job of active)
      shareJob(job, sharedJobs.get(measurementKey(job)), plannedAt);
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
    for (const job of plan.jobs) {
      if (scheduled && job.operation === "public-speed") job.availableAt = plannedAt + parseInt(crypto.createHash("sha256").update(nodeUuid).digest("hex").slice(0, 6), 16) % 120000;
      job.reportModule = mod.module;
      const reason = readiness(s, job);
      if (reason)
        completeAndProject(job, {
          kind: R.kindFor(job.operation),
          state: "missing",
          diagnostic: reason,
        });
      else s.jobs.push(job);
    }
    return round.id;
  }
  function rebuildHomeRoutes(uuids) {
    for (const uuid of uuids) {
      let cursor = "";
      do {
        const page = store.list(uuid, "routes", { limit: 50, cursor });
        for (const row of page.rounds) {
          if (!row.detailAvailable) continue;
          for (const measurement of store.get(uuid, row.id)?.measurements || []) homeRoutes.observe(measurement, false);
        }
        cursor = page.nextCursor;
      } while (cursor);
    }
    homeRoutes.save();
  }
  function homePayload(s, uuids, admin = false) {
    const nodes = homeRoutes.summary(uuids);
    // Tool diagnostics can contain private endpoint addresses; only admins receive them.
    if (!admin) for (const node of Object.values(nodes)) for (const rows of Object.values(node)) for (const row of rows) for (const key of ["forward", "return"]) if (row[key]) row[key].diagnostic = "";
    return { available: true, nodes, access: admin ? "admin" : "public",
      published: uuids.filter(id => (s.homeRouteNodes || []).includes(id)), display: s.homeRouteDisplay !== false };
  }
  route("GET", "/home-routes", (_req, res, s) => {
    const ids = s.inventory.map(n => n.uuid);
    // Rebuild once after upgrading the projection, using only retained v3 rounds.
    if (s.homeRouteProjectionVersion !== 3) {
      rebuildHomeRoutes(ids); s.homeRouteProjectionVersion = 3; native.save(s);
    }
    ctx.respond(res, 200, homePayload(s, ids, true));
  });
  route("POST", "/home-routes/rebuild", (_req, res, s) => {
    rebuildHomeRoutes(s.inventory.map(n => n.uuid));
    ctx.respond(res, 200, homePayload(s, s.inventory.map(n => n.uuid), true));
  });
  // Explicit per-node publication; old installations publish nothing by default.
  route("PUT", "/home-routes", (req, res, s) => {
    const body = ctx.readBody(req);
    if (body.revision !== s.revision) { ctx.respond(res, 409, { error: "配置已变化，请刷新后保存" }); return; }
    if (!Array.isArray(body.nodeUuids) || body.nodeUuids.length > 2000 || body.nodeUuids.some(id => !UUID.test(id))) throw new Error("节点范围无效");
    const allowed = new Set(s.inventory.filter(n => n.publicVisible === true).map(n => n.uuid));
    const selected = [...new Set(body.nodeUuids)];
    if (selected.some(id => !allowed.has(id))) throw new Error("只能发布当前可见节点的线路摘要，请刷新清单");
    rebuildHomeRoutes(selected);
    s.homeRouteNodes = selected;
    if (typeof body.display === "boolean") s.homeRouteDisplay = body.display;
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
    for (const uuid of uuids) {
      if (!force && speedHistoryChecked.has(uuid)) continue;
      // Summaries are newest planned round first. Read only the latest finished
      // manifest; its metrics survive raw-detail expiration. No target files.
      let cursor = "", found = false;
      do {
        const page = store.list(uuid, "china-speed", { limit: 50, cursor });
        for (const row of page.rounds) {
          if (!row.completedAt) continue;
          const round = store.get(uuid, row.id, false);
          if (round && homeSpeeds.observe(round, force)) { found = true; break; }
          if (round?.completedAt && round.parameters?.family) { found = true; break; }
        }
        cursor = page.nextCursor;
      } while (!found && cursor);
      speedHistoryChecked.add(uuid);
    }
  }
  function speedPayload(s, ids, admin) {
    return { available: true, nodes: homeSpeeds.summary(ids),
      access: admin ? "admin" : "public", display: s.homeSpeedDisplay !== false,
      published: ids.filter(id => (s.homeSpeedNodes || []).includes(id)) };
  }
  route("GET", "/home-speeds", (_req, res, s) => {
    const ids = s.inventory.map(n => n.uuid);
    rebuildHomeSpeeds(ids);
    ctx.respond(res, 200, speedPayload(s, ids, true));
  });
  route("POST", "/home-speeds/rebuild", (_req, res, s) => {
    const ids = s.inventory.map(n => n.uuid);
    rebuildHomeSpeeds(ids, true);
    ctx.respond(res, 200, speedPayload(s, ids, true));
  });
  route("PUT", "/home-speeds", (req, res, s) => {
    const body = ctx.readBody(req);
    if (body.revision !== s.revision) { ctx.respond(res, 409, { error: "配置已变化，请刷新后保存" }); return; }
    if (!Array.isArray(body.nodeUuids) || body.nodeUuids.length > 2000 || body.nodeUuids.some(id => !UUID.test(id))) throw new Error("节点范围无效");
    const visible = new Set(s.inventory.filter(n => n.publicVisible === true).map(n => n.uuid));
    const selected = [...new Set(body.nodeUuids)];
    if (selected.some(id => !visible.has(id))) throw new Error("只能发布当前可见节点的测速摘要，请刷新清单");
    rebuildHomeSpeeds(selected);
    s.homeSpeedNodes = selected;
    if (typeof body.display === "boolean") s.homeSpeedDisplay = body.display;
    s.revision++; native.save(s);
    ctx.respond(res, 200, { revision: s.revision });
  });
  ctx.server.route("GET", BASE + "/public/speeds", async (_req, res) => {
    try {
      await native.lock(() => {
        const s = native.read(), visible = new Set(s.inventory.filter(n => n.publicVisible === true).map(n => n.uuid));
        const ids = (s.homeSpeedNodes || []).filter(id => visible.has(id));
        ctx.respond(res, 200, speedPayload(s, ids, false));
      });
    } catch (_error) { ctx.respond(res, 503, { error: "测速摘要暂不可用" }); }
  });
  route("GET", "/capabilities", (_req, res) =>
    ctx.respond(res, 200, capabilities),
  );
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
      homeSpeedNodes: s.homeSpeedNodes || [],
      homeSpeedDisplay: s.homeSpeedDisplay !== false,
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
        const id = enqueue(s, suite, mod, node.uuid, batchId, Date.now());
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
  route("GET", "/nodes/:uuid/rounds/:id", (req, res) => {
    const result = store.get(part(req, 2), part(req, 4));
    ctx.respond(
      res,
      result ? 200 : 404,
      result || { error: "轮次不存在或已超过保留期" },
    );
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
    if (s.homeRouteProjectionVersion !== 3 && s.inventory.length) {
      rebuildHomeRoutes(s.inventory.map(n => n.uuid)); s.homeRouteProjectionVersion = 3;
    }
    if (!recovered && s.inventory.length) {
      const pending = s.inventory.flatMap((node) => store.pending(node.uuid));
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
      for (const job of pending) {
        if (!knownIds.has(job.id)) {
          if (job.sharedJobId && job.sharedRoundId) {
            const result = store
              .get(job.nodeUuid, job.sharedRoundId)
              ?.measurements.find((m) => m.id === job.sharedJobId);
            if (result && result.data.state !== "cancelled") {
              completeAndProject(
                job,
                { ...result.data, sharedMeasurementId: result.id },
                result.source,
              );
              continue;
            }
          }
          const reason = readiness(s, job);
          if (reason || job.expiresAt <= now)
            completeAndProject(job, {
              kind: R.kindFor(job.operation),
              state: "missing",
              diagnostic: reason || "恢复时任务已超过排队期限",
            });
          else {
            if (!job.sharedJobId || !recoverableIds.has(job.sharedJobId)) {
              delete job.sharedJobId;
              delete job.sharedRoundId;
              delete job.waitReason;
              // A leased measurement may still be executing or in the worker's
              // durable outbox. Keep its lease so recovery does not rerun traffic.
              if (!["running", "provider", "bgp-running"].includes(job.phase))
                job.phase = "queued";
              if (job.phase === "queued")
                shareJob(
                  job,
                  sharedJobs.get(measurementKey(job)),
                  job.plannedAt || job.queuedAt,
                );
            }
            s.jobs.push(job);
            knownIds.add(job.id);
            if (!job.sharedJobId) sharedJobs.set(measurementKey(job), job);
            store.progress(job);
          }
        }
      }
      for (const follower of s.jobs.filter(
        (j) => j.sharedJobId && !knownIds.has(j.sharedJobId),
      )) {
        const result = store
          .get(follower.nodeUuid, follower.sharedRoundId)
          ?.measurements.find((m) => m.id === follower.sharedJobId);
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
          store.progress(follower);
        }
      }
      recovered = true;
    }
    for (const suite of s.reportSuites.filter((p) => p.enabled))
      for (const mod of suite.modules.filter(
        (m) => m.enabled && m.nextAt <= now,
      )) {
        const batchId = crypto.randomUUID();
        for (const node of members(suite, s))
          enqueue(s, suite, mod, node.uuid, batchId, mod.nextAt, true);
        mod.nextAt = M.next(mod.timing, now);
      }
    if (!s.reportMaintenanceAt || now - s.reportMaintenanceAt > 3600000) {
      for (const node of s.inventory) store.cleanup(node.uuid);
      s.reportMaintenanceAt = now;
    }
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
        store.progress(candidate);
        native.save(s);
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
        native.save(s);
      });
    } finally {
      bgpBusy = false;
    }
  }
  return {
    store,
    tick,
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
        const old = recent
          ? store
              .get(job.nodeUuid, recent.id)
              ?.measurements.find(
                (r) =>
                  r.slotId === job.slotId &&
                  r.target === job.target &&
                  r.options.family === job.options.family &&
                  r.options.protocol === job.options.protocol &&
                  JSON.stringify([
                    r.source.provider,
                    r.source.id || r.source.probeId || "",
                    r.source.city,
                    r.source.asn,
                  ]) ===
                    JSON.stringify([
                      (source || job.source).provider,
                      (source || job.source).id ||
                        (source || job.source).probeId ||
                        "",
                      (source || job.source).city,
                      (source || job.source).asn,
                    ]),
              )
          : null;
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
    capabilities,
  };
}
module.exports = { registerReportController, BASE, MAX_QUEUE };
