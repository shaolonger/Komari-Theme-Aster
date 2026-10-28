const path = require("path"),
  crypto = require("crypto");
const { UUID } = require("./model.js");
const M = require("./native-model.js"),
  G = require("./globalping.js");
const { createEnricher } = require("./route-enrichment.js");
const BASE = "/api/aster-network-observatory/v2";
const RUNNER_RELEASE = require("./runner-release.json");
function registerNativeController(ctx) {
  const {
    server,
    storageDir,
    isMissingFile,
    respond,
    authorized,
    readBody,
    readState,
    writeState,
  } = ctx;
  const file = path.join(storageDir, "native-state.json"),
    enricher = createEnricher(ctx.enrichmentOptions);
  let queue = Promise.resolve(),
    busy = false, lastCatalogTick = 0, lastSavedAt = 0, heartbeatDirty = false;
  let expiryJobs = [], expiryCursor = 0, expiryTimer = null;
  let indexedJobs = null;
  let roundController = null;
  const lock = (fn) => {
    const run = async () => {
      try { return await fn(); }
      catch (error) { stateFile.invalidate(); indexedJobs = null; heartbeatDirty = false; throw error; }
    };
    const promise = queue.then(run, run);
    queue = promise.then(
      () => {},
      () => {},
    );
    return promise;
  };
  const blank = () => ({
    revision: 0,
    probes: {},
    workers: {},
    endpoints: {},
    jobs: [],
    inventory: [],
    provider: {
      hour: 0,
      used: 0,
      blockedUntil: 0,
      probes: [],
      checkedAt: 0,
      error: "",
    },
  });
  const stateFile = require("./native-queue-state.js").nativeQueueState(file, isMissingFile, blank, value => {
    if (!value || !Array.isArray(value.jobs))
      throw new Error("原生观测状态损坏；停止写入");
    delete value.policies;
    value.jobs = value.jobs.filter(job => job.roundId);
    return value;
  });
  const read = stateFile.read;
  function save(s, heartbeatOnly = false, jobOnly = false) {
    // Structural indexes survive preference / heartbeat writes. Only occupancy
    // depends on phases, and callers may have updated them before saving.
    if (!heartbeatOnly && indexedJobs) indexedJobs.occupied = null;
    if (heartbeatOnly) heartbeatDirty = true;
    // Claims, results, credentials and maintenance leases remain durable before
    // responding. Liveness renewals are coalesced and tracked for the next tick.
    if (heartbeatOnly && Date.now() - lastSavedAt < 30000) return;
    const result = stateFile.write(s, { metadata: !jobOnly });
    if (!jobOnly || result.metadataWritten) { lastSavedAt = Date.now(); heartbeatDirty = false; }
  }
  function jobIndex(s) {
    if (indexedJobs?.jobs === s.jobs && indexedJobs.length === s.jobs.length) return indexedJobs;
    const byWorker = new Map(), byId = new Map(), followers = new Map(), byScope = new Map(), byRound = new Map();
    const add = (key, job) => {
      if (!byWorker.has(key)) byWorker.set(key, []);
      byWorker.get(key).push(job);
    };
    for (const job of s.jobs) {
      byId.set(job.id, job);
      const roundKey = job.nodeUuid + "|" + job.roundId;
      byRound.set(roundKey, (byRound.get(roundKey) || 0) + 1);
      const scope = [job.nodeUuid, job.policyId, job.reportModule].join("|");
      if (!byScope.has(scope)) byScope.set(scope, []);
      byScope.get(scope).push(job);
      add(job.executor, job);
      if (job.operation === "benchmark" && job.executor !== "node:" + job.nodeUuid)
        add("node:" + job.nodeUuid, job);
      if (job.sharedJobId) {
        if (!followers.has(job.sharedJobId)) followers.set(job.sharedJobId, []);
        followers.get(job.sharedJobId).push(job);
      }
    }
    indexedJobs = { jobs: s.jobs, length: s.jobs.length, byWorker, byId, followers, byScope, byRound, occupied: null };
    return indexedJobs;
  }
  function occupiedJobs(s) {
    const index = jobIndex(s);
    if (!index.occupied) index.occupied = s.jobs.filter(job =>
      ["listening", "ready", "running", "submitting", "provider"].includes(job.phase));
    return index.occupied;
  }
  function workerJobs(s, w) { return jobIndex(s).byWorker.get(w.key) || []; }
  function workerBusy(s, w) {
    return workerJobs(s, w).some(j => ["running", "ready", "listening"].includes(j.phase));
  }
  function pendingJobsFor(s, nodeUuid, suiteId, module) {
    return jobIndex(s).byScope.get([nodeUuid, suiteId, module].join("|")) || [];
  }
  function isRoundActive(s, nodeUuid, id) { return jobIndex(s).byRound.has(nodeUuid + "|" + id); }
  function touchJob(job) { stateFile.touchJob(job); }
  function route(method, suffix, admin, fn, prepare) {
    server.route(method, BASE + suffix, async (req, res) => {
      if (admin && !authorized(req, res)) return;
      try {
        const prepared = prepare ? await prepare(req, res) : undefined;
        if (prepared === null) return;
        await lock(async () => {
          const s = read();
          await fn(req, res, s, prepared);
        });
      } catch (e) {
        respond(res, 400, { error: String(e.message || e) });
      }
    });
  }
  function workerId(req) {
    const match = /\/workers\/(node|probe)\/([0-9a-f-]{36})\//i.exec(
      String(req.url),
    );
    return match && UUID.test(match[2])
      ? { role: match[1], id: match[2], key: match[1] + ":" + match[2] }
      : null;
  }
  function auth(req, res, s) {
    const w = workerId(req),
      raw = req.headers?.authorization,
      match = /^Bearer ([0-9a-f]{64})$/i.exec(
        Array.isArray(raw) ? raw[0] : raw || "",
      );
    const stored =
      w && (w.role === "node" ? readState().nodes[w.id] : s.probes[w.id]);
    if (!stored || !match) {
      respond(res, 401, { error: "测量端凭证无效" });
      return null;
    }
    const hash = crypto
      .createHash("sha256")
      .update(match[1].toLowerCase())
      .digest("hex");
    if (
      !crypto.timingSafeEqual(
        Buffer.from(hash, "hex"),
        Buffer.from(stored.tokenHash, "hex"),
      )
    ) {
      respond(res, 401, { error: "测量端凭证无效" });
      return null;
    }
    return w;
  }
  function online(s, key) {
    const w = s.workers[key];
    return !!w && Date.now() - w.seenAt < 90000;
  }
  function coverage(s, j) {
    if (!j.target) return "缺少符合地址族的公网目标";
    if (j.executor === "globalping") {
      if (s.provider.used >= 120 || s.provider.blockedUntil > Date.now())
        return "公共测量额度等待恢复";
      return s.provider.probes.some(
        (p) => p.location?.country === "CN" && p.location.asn === j.source.asn,
      )
        ? ""
        : "公共目录未确认此 ASN 的当前覆盖";
    }
    if (!online(s, j.executor)) return "测量端未就绪";
    const tools = s.workers[j.executor].tools;
    if (j.operation === "website" && !tools.includes("curl"))
      return "测量端缺少 curl";
    if (j.operation === "route" && j.options?.fullMtr && !tools.includes("mtr"))
      return "完整逐跳统计需要 mtr；请重新运行一键安装命令补齐依赖";
    if (
      j.operation === "route" &&
      !tools.includes("nexttrace") &&
      !tools.includes("traceroute") &&
      !tools.includes("mtr")
    )
      return "测量端缺少路径工具";
    if (j.operation === "iperf-speed" && !tools.includes("iperf3"))
      return "测量端缺少 iperf3";
    if (j.operation === "benchmark") {
      const node = s.workers["node:" + j.nodeUuid];
      if (!online(s, "node:" + j.nodeUuid)) return "VPS 测量端未就绪";
      if (
        !node.tools.includes("openssl") ||
        node.authScheme === "unavailable" ||
        s.workers[j.executor].authScheme === "unavailable"
      )
        return "两端需要认证 iperf3，VPS 端另需 openssl";
    }
    return "";
  }
  function finishMany(s, entries, options = {}) {
    const index = jobIndex(s), removed = new Set(), started = Date.now();
    let processed = 0;
    const complete = () => {
      for (const entry of entries) {
        if (processed && options.budgetMs && Date.now() - started >= options.budgetMs) break;
        processed++;
        const j = entry.job, data = entry.data, source = entry.source || j.source;
        // A leader may already have completed another entry as its follower.
        if (removed.has(j.id) || index.byId.get(j.id) !== j) continue;
        if (j.roundId) roundController.complete(j, data, source);
        const followers = (index.followers.get(j.id) || []).filter(x =>
          x.sharedJobId === j.id && !removed.has(x.id));
        if (data.state !== "cancelled") {
          for (const follower of followers) {
            roundController.complete(follower, { ...data, sharedMeasurementId: j.id }, source);
            removed.add(follower.id); stateFile.forgetJob(follower);
          }
        } else {
          for (const follower of followers) {
            delete follower.sharedJobId;
            delete follower.sharedRoundId;
            delete follower.waitReason;
            follower.phase = "queued";
            roundController.progress(follower); touchJob(follower);
          }
        }
        removed.add(j.id); stateFile.forgetJob(j);
      }
      if (removed.size) {
        // Preserve FIFO order with one compaction for the entire batch.
        s.jobs = s.jobs.filter(x => !removed.has(x.id));
        const workers = new Set(), scopes = new Set(), leaders = new Set();
        for (const id of removed) {
          const job = index.byId.get(id);
          if (!job) continue;
          workers.add(job.executor);
          if (job.operation === "benchmark") workers.add("node:" + job.nodeUuid);
          scopes.add([job.nodeUuid, job.policyId, job.reportModule].join("|"));
          const key = job.nodeUuid + "|" + job.roundId, remaining = index.byRound.get(key) - 1;
          if (remaining) index.byRound.set(key, remaining); else index.byRound.delete(key);
          if (job.sharedJobId) leaders.add(job.sharedJobId);
          index.followers.delete(id); index.byId.delete(id);
        }
        const prune = (map, keys) => { for (const key of keys) {
          const rows = (map.get(key) || []).filter(job => !removed.has(job.id));
          if (rows.length) map.set(key, rows); else map.delete(key);
        } };
        prune(index.byWorker, workers); prune(index.byScope, scopes); prune(index.followers, leaders);
        index.jobs = s.jobs; index.length = s.jobs.length; index.occupied = null;
        indexedJobs = index;
      }
    };
    if (roundController.batch) roundController.batch(complete);
    else complete();
    return processed;
  }
  function finish(s, j, data, source = j.source) {
    finishMany(s, [{ job: j, data, source }]);
  }
  function queueExpirations(s) {
    if (expiryCursor < expiryJobs.length) return;
    expiryJobs = s.jobs.filter(j => j.expiresAt < Date.now() || !j.target).map(j => j.id);
    expiryCursor = 0;
  }
  function drainExpirations(s) {
    const entries = [], index = jobIndex(s), now = Date.now();
    while (expiryCursor < expiryJobs.length && entries.length < 16) {
      const position = expiryCursor++, j = index.byId.get(expiryJobs[position]);
      // A heartbeat, retry, cancellation or result can change a queued snapshot.
      if (!j || (j.expiresAt >= now && j.target)) continue;
      entries.push({ position, job: j, data: {
        kind: require("./report-model.js").kindFor(j.operation),
        ...(j.operation === "tcpquality-full" && j.phase === "running" ? { deadlineExpired: true } : {}),
        state: !j.target || j.phase === "queued" ? "missing" : "failed",
        diagnostic: !j.target
          ? j.direction === "VPS→大陆"
            ? "大陆探针未声明可达公网地址（NAT 后不推断反向路径）"
            : "请设置此 VPS 的可达公网地址"
          : "任务超时：" + (coverage(s, j) || "测量或排队没有按期完成"),
      } });
    }
    if (!entries.length) return false;
    const processed = finishMany(s, entries, { budgetMs: 10 });
    if (processed < entries.length) expiryCursor = entries[processed].position;
    return true;
  }
  function continueExpirations() {
    if (expiryTimer !== null || expiryCursor >= expiryJobs.length) return;
    expiryTimer = setTimeout(() => {
      expiryTimer = null;
      void lock(() => {
        const s = read();
        if (drainExpirations(s)) save(s, false, true);
      }).then(continueExpirations, e => {
        // A later minute tick retries persistent state / disk failures. Do not
        // turn a corrupt report into a tight retry loop or lose its queue job.
        expiryJobs = []; expiryCursor = 0;
        console.error("Aster expiry maintenance:", String(e.message || e));
      });
    }, 500);
  }
  route("GET", "/catalog", true, (_req, res, s) => {
    void catalogTick();
    respond(res, 200, {
      runnerRelease: RUNNER_RELEASE,
      updatePolicies: s.updatePolicies || {}, updates: s.updates || {},
      revision: s.revision, inventory: s.inventory, inventoryError: s.inventoryError,
      workers: s.workers, endpoints: s.endpoints,
      registeredNodes: Object.keys(readState().nodes),
      probes: Object.entries(s.probes).map(([id, p]) => {
        const { tokenHash: _hash, ...safe } = p;
        return { id, ...safe, online: online(s, "probe:" + id) };
      }),
    });
  });
  route("POST", "/nodes/:uuid/token", true, (req, res, s) => {
    const uuid = String(req.url).split("/").slice(-2)[0];
    if (!UUID.test(uuid) || !s.inventory.some(n => n.uuid === uuid)) throw new Error("节点标识无效，请刷新清单");
    const token = crypto.randomBytes(32).toString("hex"), identities = readState();
    identities.nodes[uuid] = { tokenHash: crypto.createHash("sha256").update(token).digest("hex"), tokenIssuedAt: new Date().toISOString() };
    writeState(identities);
    delete s.workers["node:" + uuid];
    finishMany(s, s.jobs.filter(j => j.executor === "node:" + uuid || j.nodeUuid === uuid).map(job => ({ job, data: { kind: require("./report-model.js").kindFor(job.operation), state: "cancelled", diagnostic: "VPS 探测器凭证已重置" } })));
    save(s); respond(res, 201, { uuid, token });
  });
  route("DELETE", "/nodes/:uuid/token", true, (req, res, s) => {
    const uuid = String(req.url).split("/").slice(-2)[0];
    if (!UUID.test(uuid)) throw new Error("节点标识无效");
    const identities = readState(); delete identities.nodes[uuid]; writeState(identities);
    delete s.workers["node:" + uuid];
    finishMany(s, s.jobs.filter(j => j.executor === "node:" + uuid || j.nodeUuid === uuid).map(job => ({ job, data: { kind: require("./report-model.js").kindFor(job.operation), state: "cancelled", diagnostic: "VPS 探测器凭证已撤销" } })));
    save(s); respond(res, 200, { ok: true });
  });
  // Komari retains Gin route slots after unload. Preserve the pre-1.9 wildcard
  // name; a clean 1.9.0 installation instead needs its existing :id slots reused.
  // These credential shims execute no legacy tests or schedules.
  let credentialParameter = ":uuid";
  const credentialHeartbeat = (req, res) => {
    const translated = { headers: req.headers, url: String(req.url).replace("/v1/nodes/", "/v2/workers/node/") };
    if (auth(translated, res, read())) respond(res, 200, { ok: true });
  };
  for (const action of ["verify", "heartbeat"]) {
    const prefix = "/api/aster-network-observatory/v1/nodes/";
    try {
      server.route("POST", prefix + credentialParameter + "/" + action, credentialHeartbeat);
    } catch (error) {
      if (credentialParameter !== ":uuid" || !String(error?.message || error).includes("conflicts with existing wildcard ':id'")) throw error;
      credentialParameter = ":id";
      server.route("POST", prefix + credentialParameter + "/" + action, credentialHeartbeat);
    }
  }
  route("POST", "/endpoints", true, async (req, res, s) => {
    const input = readBody(req);
    if (!UUID.test(input.nodeUuid || "")) throw new Error("节点标识无效");
    const port = Number(input.port || 25201);
    if (!Number.isInteger(port) || port < 20000 || port > 40000)
      throw new Error("测速端口需在 20000–40000");
    if (!s.inventory.some(n => n.uuid === input.nodeUuid)) throw new Error("节点不存在，请刷新清单");
    if (input.ipv4 && (!/^[0-9.]+$/.test(input.ipv4) || !require("./model.js").isHost(input.ipv4))) throw new Error("IPv4 地址无效");
    if (input.ipv6 && (!input.ipv6.includes(":") || !require("./model.js").isHost(input.ipv6))) throw new Error("IPv6 地址无效");
    s.endpoints[input.nodeUuid] = {
      address: M.host(input.address || input.ipv4 || input.ipv6),
      ipv4: input.ipv4 ? M.host(input.ipv4) : "",
      ipv6: input.ipv6 ? M.host(input.ipv6) : "",
      port,
    };
    s.revision++;
    save(s);
    respond(res, 200, { ok: true });
  });
  route("POST", "/probes", true, async (req, res, s) => {
    const input = readBody(req),
      id = UUID.test(input.id || "") ? input.id : crypto.randomUUID();
    if (Object.keys(s.probes).length >= 100 && !s.probes[id])
      throw new Error("最多 100 个大陆探针");
    if (
      !["电信", "联通", "移动", "其他"].includes(input.carrier) ||
      !["家庭宽带", "机房", "企业", "未知"].includes(input.accessType) ||
      !M.text(input.city) ||
      !M.text(input.name)
    )
      throw new Error("请完整填写测量点名称、城市、运营商与接入类型");
    const token = crypto.randomBytes(32).toString("hex");
    s.probes[id] = {
      name: M.text(input.name),
      city: M.text(input.city),
      carrier: input.carrier,
      accessType: input.accessType,
      publicAddress: input.publicAddress ? M.host(input.publicAddress) : "",
      country: "CN",
      locationDeclared: true,
      tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
    };
    delete s.workers["probe:" + id];
    s.revision++;
    save(s);
    respond(res, 200, { id, token });
  });
  route("DELETE", "/probes/:id", true, async (req, res, s) => {
    const id = String(req.url).split("/").pop();
    delete s.probes[id];
    delete s.workers["probe:" + id];
    finishMany(s, s.jobs.filter(j => j.executor === "probe:" + id).map(job => ({ job,
      data: { kind: require("./report-model.js").kindFor(job.operation), state: "missing", diagnostic: "探针已撤销" },
    })));
    s.revision++;
    save(s);
    respond(res, 200, { ok: true });
  });
  for (const role of ["node", "probe"]) {
    route("PUT", `/workers/${role}/:id/update-policy`, true, (req, res, s) => {
      const w = workerId(req), b = readBody(req);
      if (!w || !(role === "node" ? readState().nodes[w.id] : s.probes[w.id]) || typeof b.enabled !== "boolean") throw new Error("测量端或自动更新偏好无效");
      const policies = (s.updatePolicies ||= {});
      if (!policies[w.key] || policies[w.key].enabled !== b.enabled) {
        policies[w.key] = { enabled: b.enabled };
        save(s);
      }
      respond(res, 200, { ok: true });
    });
    route("GET", `/workers/${role}/:id/update-policy`, false, (req, res, s) => {
      const w = auth(req, res, s);
      if (w) respond(res, 200, { enabled: s.updatePolicies?.[w.key]?.enabled === true, release: RUNNER_RELEASE, version: s.workers[w.key]?.version || "", instanceId: s.workers[w.key]?.instanceId || "", busy: workerBusy(s, w) });
    });
    route("POST", `/workers/${role}/:id/maintenance`, false, (req, res, s) => {
      const w = auth(req, res, s);
      if (!w) return;
      const b = readBody(req), leases = (s.maintenance ||= {}), lease = leases[w.key];
      if (b.action === "report") {
        if (!["ok", "waiting", "failed"].includes(b.state)) throw new Error("维护状态无效");
        const updates = (s.updates ||= {}), message = M.text(b.message, 300), previous = updates[w.key];
        // Hourly checks normally report the same "waiting / already current"
        // status. Preserve its change timestamp rather than rewriting every job.
        if (!previous || previous.state !== b.state || previous.message !== message) {
          updates[w.key] = { state: b.state, message, at: new Date().toISOString() };
          save(s);
        }
        respond(res, 200, { ok: true }); return;
      }
      if (b.action === "claim") {
        if (b.automatic && s.updatePolicies?.[w.key]?.enabled !== true) { respond(res, 409, { error: "自动更新未启用" }); return; }
        if (b.version !== RUNNER_RELEASE.version) throw new Error("目标探测器版本与面板不兼容");
        if ((lease && lease.until > Date.now()) || workerBusy(s, w)) {
          respond(res, 409, { error: "测量端忙，等待当前测量完成后重试" }); return;
        }
        const id = crypto.randomBytes(16).toString("hex");
        leases[w.key] = { id, until: Date.now() + 600000 };
        (s.updates ||= {})[w.key] = { state: "updating", message: "已进入维护，正在验证并更新探测器", at: new Date().toISOString() };
        save(s); respond(res, 200, { lease: id }); return;
      }
      if (b.action !== "release" || !lease || b.lease !== lease.id) throw new Error("维护租约无效");
      delete leases[w.key];
      (s.updates ||= {})[w.key] = { state: ["ok", "failed", "waiting"].includes(b.state) ? b.state : "failed", message: M.text(b.message, 300), at: new Date().toISOString() };
      save(s); respond(res, 200, { ok: true });
    });
    route("POST", `/workers/${role}/:id/verify`, false, async (req, res, s) => {
      if (auth(req, res, s)) respond(res, 200, { ok: true });
    });
    route(
      "POST",
      `/workers/${role}/:id/heartbeat`,
      false,
      async (req, res, s) => {
        const w = auth(req, res, s);
        if (!w) return;
        const b = readBody(req);
        s.workers[w.key] = {
          seenAt: Date.now(),
          version: M.text(b.version, 30),
          instanceId: /^[0-9a-f]{32}$/.test(b.instanceId || "") ? b.instanceId : "",
          tools: Array.isArray(b.tools)
            ? b.tools.filter((x) =>
                [
                  "curl",
                  "nexttrace",
                  "traceroute",
                  "mtr",
                  "iperf3",
                  "openssl", "nping",
                ].includes(x),
              )
            : [],
          authScheme: ["oaep", "pkcs1"].includes(b.authScheme)
            ? b.authScheme
            : "unavailable",
          features: Array.isArray(b.features)
            ? b.features.filter((f) =>
                [
                  "report-v3",
                  "latency-samples",
                  "full-mtr",
                  "speed-intervals",
                  "http-speed", "public-speed", "tcp-quality", "tcpquality-full",
                ].includes(f),
              )
            : [],
        };
        const active = Array.isArray(b.activeJobIds)
          ? b.activeJobIds.filter((id) => UUID.test(id)).slice(0, 4)
          : [];
        for (const j of workerJobs(s, w))
          if (
            j.roundId &&
            j.executor === w.key &&
            j.phase === "running" &&
            active.includes(j.id)
          ) {
            if (j.operation !== "tcpquality-full") j.expiresAt = Math.min(Date.now() + 90000, j.deadlineAt || j.expiresAt);
            touchJob(j);
          }
        save(s, true);
        respond(res, 200, {
          ok: true,
          activeJobIds: workerJobs(s, w)
            .filter(
              (j) =>
                (j.executor === w.key && j.phase === "running") ||
                (j.operation === "benchmark" &&
                  w.key === "node:" + j.nodeUuid &&
                  ["listening", "ready", "running"].includes(j.phase)),
            )
            .map((j) => j.id),
        });
      },
    );
    route("GET", `/workers/${role}/:id/poll`, false, async (req, res, s) => {
      const w = auth(req, res, s);
      if (!w) return;
      if (s.maintenance?.[w.key]?.until > Date.now()) {
        respond(res, 200, { task: null, listeners: [] }); return;
      }
      const occupied = occupiedJobs(s);
      let task = null, changed = false;
      for (const j of workerJobs(s, w)) {
        // Expired tasks may be awaiting a bounded maintenance batch. Never
        // dispatch one merely because its disk cleanup has not run yet.
        if (j.expiresAt <= Date.now() || !j.target) continue;
        if (
          j.roundId &&
          j.executor === w.key &&
          !s.workers[w.key]?.features?.includes("report-v3")
        )
          continue;
        if (
          j.phase === "queued" &&
          (!j.availableAt || j.availableAt <= Date.now()) &&
          (j.operation !== "public-speed" || !s.publicSpeedBlockedUntil || s.publicSpeedBlockedUntil <= Date.now()) &&
          j.executor === w.key &&
          j.operation !== "benchmark" &&
          !(
            ["http-speed", "iperf-speed", "public-speed"].includes(j.operation) &&
            occupied.some(
              (x) =>
                ["http-speed", "iperf-speed", "public-speed"].includes(x.operation) &&
                (j.operation === "public-speed" || (x.target === j.target &&
                x.options.port === j.options.port)),
            )
          ) &&
          !occupied.some(
            (x) =>
              (x.executor === w.key &&
                !(
                  j.roundId &&
                  j.operation === "latency" &&
                  x.roundId &&
                  x.operation === "latency"
                )) ||
              (x.operation === "benchmark" && x.nodeUuid === w.id),
          ) &&
          !(
            j.roundId &&
            j.operation === "latency" &&
            occupied.filter(
              (x) => x.executor === w.key && x.operation === "latency",
            ).length >= 4
          )
        ) {
          // A worker may have lost its optional helper after this round was
          // queued. Do not reserve an hours-long job for a worker whose last
          // heartbeat already says that the helper is unavailable.
          const problem = j.operation === "tcpquality-full" && !s.workers[w.key]?.features?.includes("tcpquality-full")
            ? "完整 TcpQuality 执行器未就绪；请检查服务并重新执行"
            : coverage(s, j);
          changed = true;
          if (problem) {
            finish(s, j, {
              kind: ["benchmark", "http-speed", "iperf-speed", "public-speed"].includes(
                j.operation,
              )
                ? "speed"
                : j.operation,
              state: "missing",
              diagnostic: problem,
            });
            break;
          }
          j.phase = "running";
          j.expiresAt = Date.now() + 180000;
          if (j.roundId) {
            j.deadlineAt = Date.now() + (j.operation === "tcpquality-full" ? ((j.options?.timeoutMinutes || 120) + 15) * 60000 : 300000);
            // Reserve the long run until its hard deadline even during a
            // worker outage; replaying a benchmark can be intrusive.
            if (j.operation === "tcpquality-full") j.expiresAt = j.deadlineAt;
          }
          j.startedAt = new Date().toISOString();
          task = { ...j };
          if (
            j.options?.endpoint?.id &&
            s.reportSecrets?.[j.options.endpoint.id]
          )
            task.credentials = {
              token: s.reportSecrets[j.options.endpoint.id],
            };
          if (j.roundId) roundController.progress(j);
          touchJob(j);
          break;
        }
        if (
          j.operation === "benchmark" &&
          j.phase === "queued" &&
          (!j.availableAt || j.availableAt <= Date.now()) &&
          w.key === "node:" + j.nodeUuid &&
          !occupied.some(
            (x) =>
              (x.operation === "benchmark" &&
                (x.nodeUuid === j.nodeUuid || x.executor === j.executor)) ||
              x.executor === "node:" + j.nodeUuid ||
              x.executor === j.executor,
          ) &&
          online(s, j.executor)
        ) {
          changed = true;
          if (
            !s.workers[w.key] ||
            !s.workers[j.executor] ||
            s.workers[w.key].authScheme === "unavailable" ||
            s.workers[j.executor].authScheme === "unavailable" ||
            !s.workers[w.key].tools.includes("openssl")
          ) {
            finish(s, j, {
              kind: "speed",
              state: "missing",
              diagnostic: "两端需要支持认证的 iperf3，VPS 端另需 openssl",
            });
            break;
          }
          j.phase = "listening";
          j.password = crypto.randomBytes(32).toString("hex");
          j.expiresAt = Date.now() + 240000;
          touchJob(j);
          task = {
            id: j.id,
            operation: "listen",
            options: {
              port: j.options.port,
              password: j.password,
              peerScheme: s.workers[j.executor]?.authScheme,
            },
          };
          break;
        }
        if (
          j.operation === "benchmark" &&
          j.phase === "ready" &&
          j.executor === w.key
        ) {
          changed = true;
          j.phase = "running";
          touchJob(j);
          if (j.roundId) {
            j.startedAt = new Date().toISOString();
            j.deadlineAt = Date.now() + 300000;
            j.expiresAt = Date.now() + 180000;
            roundController.progress(j);
          }
          task = {
            ...j,
            credentials: {
              password: j.password,
              publicKey: j.publicKey,
              scheme: j.scheme,
            },
          };
          break;
        }
      }
      if (changed) save(s, false, true);
      respond(res, 200, {
        task,
        listeners: workerJobs(s, w)
          .filter(
            (j) =>
              j.operation === "benchmark" &&
              j.nodeUuid === w.id &&
              ["listening", "ready", "running"].includes(j.phase),
          )
          .map((j) => j.id),
      });
    });
    route(
      "POST",
      `/workers/${role}/:id/result`,
      false,
      async (req, res, s, prepared) => {
        const w = auth(req, res, s);
        if (!w) return;
        const b = prepared || readBody(req),
          j = jobIndex(s).byId.get(b.id);
        if (!j) {
          if (b.data?.kind === "tcpquality-full") {
            M.validateResult(b.data, "tcpquality-full");
            if (roundController.acceptLateFull(b.id, w.key, b.data)) { respond(res, 200, { ok: true, late: true }); return; }
            if (b.data.reportUrl) {
              const update = roundController.updateFullReportUrl(b.id, w.key, b.data);
              if (update !== "invalid") { respond(res, 200, { ok: true, reportUpdated: update === "updated", replay: update === "unchanged" }); return; }
              respond(res, 409, { error: "报告链接或原任务不匹配" }); return;
            }
          }
          if (roundController.receipt(b.id, w.key)) {
            respond(res, 200, { ok: true, replay: true });
            return;
          }
          respond(res, 409, { error: "任务已结束" });
          return;
        }
        if (
          j.phase === "listening" &&
          w.key === "node:" + j.nodeUuid &&
          j.operation === "benchmark"
        ) {
          if (
            b.data?.state === "ready" &&
            typeof b.data.publicKey === "string" &&
            b.data.publicKey.startsWith("-----BEGIN PUBLIC KEY-----") &&
            b.data.publicKey.length < 4096 &&
            ["oaep", "pkcs1"].includes(b.data.scheme)
          ) {
            j.publicKey = b.data.publicKey;
            j.scheme = b.data.scheme;
            j.phase = "ready"; touchJob(j);
          } else
            finish(s, j, {
              kind: "speed",
              state: "failed",
              diagnostic: M.text(b.data?.diagnostic, 4000) || "测速监听失败",
            });
        } else {
          if (j.executor !== w.key || j.phase !== "running") {
            respond(res, 409, { error: "任务不属于该测量端或阶段不正确" });
            return;
          }
          const data = b.data,
            kind = ["benchmark", "http-speed", "iperf-speed", "public-speed"].includes(
              j.operation,
            )
              ? "speed"
              : j.operation;
          M.validateResult(data, kind);
          const publicSpeed = j.operation === "public-speed";
          const publicNoPayload = publicSpeed && !(data.trafficBytesObserved > 0) &&
            !(data.runs || []).some(r => r.trafficBytesObserved > 0 || r.bytes > 0 || r.warmupBytesObserved > 0 ||
              (r.attempts || []).some(a => a.trafficBytesObserved > 0));
          const legacyTransient = publicSpeed && data.toolVersion !== "aster-public-speed/2" &&
            /timed out|time[ -]?out|connection reset|connection refused|temporar(?:y|ily)|HTTP (?:408|429|500|502|503|504)/i.test(data.diagnostic || "") &&
            !/certificate|HTTP (?:400|401|403|404)|参数|格式/i.test(data.diagnostic || "");
          const busyOnly =
            kind === "speed" &&
            data.state === "failed" &&
            ((publicNoPayload && (data.retryable === true || legacyTransient)) || (!publicSpeed && data.runs?.length &&
            data.runs.every(
              (r) =>
                r.state === "failed" &&
                !r.bytes &&
                /server is busy|server busy/i.test(r.diagnostic || ""),
            )));
          if (publicSpeed) {
            // Cool down between every public measurement, without timers or a
            // fleet-wide pause for a single VPS's broken network connection.
            s.publicSpeedBlockedUntil = Math.max(s.publicSpeedBlockedUntil || 0,
              Date.now() + 4000 + parseInt(crypto.createHash("sha256").update(j.id).digest("hex").slice(0, 6), 16) % 3000);
            data.queueAttempts = (j.busyAttempts || 0) + 1;
            if (j.publicSpeedFailures?.length) data.previousFailures = j.publicSpeedFailures;
          }
          if (j.roundId && busyOnly && (j.busyAttempts || 0) < 2) {
            j.busyAttempts = (j.busyAttempts || 0) + 1;
            j.phase = "queued";
            const jitter = publicSpeed ? parseInt(crypto.createHash("sha256").update(j.id + ":" + j.busyAttempts).digest("hex").slice(0, 6), 16) % 15000 : 0;
            j.availableAt = Date.now() + j.busyAttempts * 60000 + jitter;
            if (publicSpeed) {
              (j.publicSpeedFailures ||= []).push({ diagnostic: M.text(data.diagnostic, 500), stage: M.text(data.failureStage, 100), at: new Date().toISOString() });
              if (/繁忙|server.{0,8}busy|HTTP (?:429|503)/i.test(data.diagnostic || ""))
                s.publicSpeedBlockedUntil = Math.max(s.publicSpeedBlockedUntil, j.availableAt);
            }
            j.expiresAt = Date.now() + 6 * 3600000;
            delete j.deadlineAt;
            j.waitReason = "公共端点暂不可用，尚未传输测速数据；等待退避后重试";
            roundController.progress(j); touchJob(j);
            save(s);
            respond(res, 200, { ok: true, retrying: true });
            return;
          }
          if (j.operation === "public-speed" && data.missingCoverage === true) data.state = "missing";
          finish(s, j, data, {
            ...j.source,
            runnerVersion: s.workers[w.key]?.version || "",
          });
        }
        save(s, false, j.operation !== "public-speed");
        respond(res, 200, { ok: true });
      },
      async (req, res) => {
        // Check credentials and ownership before any external lookup, then check
        // again under the state lock after enrichment. No network wait holds it.
        const s = read(),
          w = auth(req, res, s);
        if (!w) return null;
        const b = readBody(req),
          j = jobIndex(s).byId.get(b.id);
        if (
          j?.operation === "route" &&
          j.executor === w.key &&
          j.phase === "running"
        ) {
          M.validateResult(b.data, "route");
          b.data = await enricher.enrich(b.data);
        }
        return b;
      },
    );
  }
  function catalogTick() {
    if (busy || Date.now() - lastCatalogTick < 60000) return;
    lastCatalogTick = Date.now();
    return tick(true);
  }
  async function tick(refreshProvider = false) {
    if (busy) return;
    busy = true;
    lastCatalogTick = Date.now();
    try {
      // Network I/O happens outside the persistent-state lock.
      let inventory = null,
        error = "";
      try {
        const raw = await server.call("admin:listClients");
        inventory = (Array.isArray(raw) ? raw : raw.clients || raw.data || [])
          .filter((n) => UUID.test(n.uuid || ""))
          .map((n) => ({
            uuid: n.uuid,
            name: n.name || n.uuid,
            group: n.group || "",
            publicVisible: n.hidden === false || n.hidden === 0 || n.hidden === "false",
            ip: n.ipv4 || n.ip_v4 || "",
            ipv6: n.ipv6 || n.ip_v6 || "",
          }));
      } catch (e) {
        error = String(e.message || e).slice(0, 200);
      }
      const actions = await lock(async () => {
        const s = read(), now = Date.now();
        let changed = false;
        if (inventory) {
          const keys = ["uuid", "name", "group", "publicVisible", "ip", "ipv6"];
          if (s.inventory.length !== inventory.length || inventory.some((row, i) => keys.some(key => row[key] !== s.inventory[i]?.[key]))) {
            s.inventory = inventory;
            changed = true;
          }
          for (const n of inventory) {
            if (!s.endpoints[n.uuid] && (n.ip || n.ipv6) && require("./model.js").isHost(n.ip || n.ipv6)) {
              s.endpoints[n.uuid] = { address: n.ip || n.ipv6, port: 25201 };
              changed = true;
            }
            const endpoint = s.endpoints[n.uuid];
            if (endpoint && endpoint.ipv6 === undefined && n.ipv6 && require("./model.js").isHost(n.ipv6)) {
              endpoint.ipv6 = n.ipv6;
              changed = true;
            }
          }
        }
        if (s.inventoryError !== error) { s.inventoryError = error; changed = true; }
        queueExpirations(s);
        if (drainExpirations(s)) changed = true;
        // Older report-controller implementations return undefined; retain
        // their conservative persistence until they provide a no-change signal.
        if (roundController.tick(s) !== false) changed = true;
        queueExpirations(s);
        const hour = Math.floor(now / 3600000);
        if (s.provider.hour !== hour) {
          // A zero quota needs no durable write merely to advance its clock.
          if (s.provider.used) changed = true;
          s.provider.hour = hour;
          s.provider.used = 0;
        }
        const out = [];
        for (const j of s.jobs) {
          if (out.length >= 3) break;
          if (j.expiresAt <= now || !j.target) continue;
          if (j.phase === "provider") {
            out.push({ id: j.id, measurementId: j.measurementId, job: { ...j }, operation: "poll" });
          } else if (j.operation === "globalping" && j.phase === "queued" &&
            s.provider.used < 120 && s.provider.blockedUntil <= now) {
            j.phase = "submitting"; touchJob(j);
            s.provider.used++;
            changed = true;
            out.push({ id: j.id, operation: "create", job: { ...j } });
          }
        }
        if ((refreshProvider || s.reportSuites?.some(p => p.enabled &&
          p.modules.some(m => m.module === "routes" && m.publicSources))) &&
          s.provider.checkedAt < now - 10 * 60000) {
          s.provider.checkedAt = now;
          changed = true;
          out.push({ operation: "probes" });
        }
        if (changed || heartbeatDirty) save(s);
        continueExpirations();
        return out;
      });
      await Promise.all(
        actions.map(async (a) => {
          let result, e, normalized;
          try {
            result =
              a.operation === "probes"
                ? await G.request("/probes")
                : a.operation === "create"
                  ? await G.create(a.job)
                  : await G.request(
                      "/measurements/" + encodeURIComponent(a.measurementId),
                    );
          } catch (err) {
            e = err;
          }
          if (!e && a.operation === "poll" && result.status === "finished") {
            normalized = G.normalize(a.job, result)[0];
            normalized.data = await enricher.enrich(normalized.data);
          }
          await lock(async () => {
            const s = read();
            let changed = false;
            if (a.operation === "probes") {
              if (Array.isArray(result)) {
                const probes = result.filter(p => p.location?.country === "CN").slice(0, 2500);
                if (JSON.stringify(s.provider.probes) !== JSON.stringify(probes)) {
                  s.provider.probes = probes; changed = true;
                }
                if (s.provider.error !== "") { s.provider.error = ""; changed = true; }
              } else {
                const message = String(e?.message || "目录不可用");
                if (s.provider.error !== message) { s.provider.error = message; changed = true; }
              }
              if (changed) save(s);
              return;
            }
            const j = jobIndex(s).byId.get(a.id);
            if (!j) return;
            if (e) {
              const message = String(e.message || e);
              if (s.provider.error !== message) { s.provider.error = message; changed = true; }
              if (e.rateLimited) {
                s.provider.blockedUntil = Date.now() + 3600000;
                if (a.operation === "create") { j.phase = "queued"; touchJob(j); }
                changed = true;
              } else if (a.operation === "create") {
                finish(s, j, { kind: "route", state: e.noCoverage ? "missing" : "failed",
                  diagnostic: "公共测量提交失败，未自动重复提交：" + s.provider.error });
                changed = true;
              }
            } else if (a.operation === "create") {
              if (!/^[a-zA-Z0-9_-]{1,80}$/.test(result.id || ""))
                finish(s, j, { kind: "route", state: "missing", diagnostic: "公共测量没有返回可用测量 ID" });
              else {
                j.measurementId = result.id;
                j.phase = "provider";
                j.expiresAt = Date.now() + 180000;
                touchJob(j);
              }
              changed = true;
            } else if (result.status === "finished") {
              const row = normalized || G.normalize(j, result)[0];
              finish(s, j, row.data, row.source);
              changed = true;
            }
            if (changed) save(s);
          });
        }),
      );
      await roundController.publicTick();
    } catch (e) {
      console.error("Aster native scheduler:", String(e.message || e));
    } finally {
      busy = false;
    }
  }
  roundController = require("./report-controller.js").registerReportController(
    ctx,
    { read, lock, save, finish, finishMany, pendingJobsFor, isRoundActive, touchJob, coverage, online, tick, catalogTick },
  );
  void tick();
  return { tick, read, lock, roundController };
}
module.exports = { registerNativeController, BASE };
