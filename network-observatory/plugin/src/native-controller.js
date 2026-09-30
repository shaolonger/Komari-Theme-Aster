const fs = require("fs"),
  path = require("path"),
  crypto = require("crypto");
const { UUID } = require("./model.js");
const M = require("./native-model.js"),
  G = require("./globalping.js");
const { archive } = require("./native-archive.js");
const BASE = "/api/aster-network-observatory/v2";
function registerNativeController(ctx) {
  const {
    server,
    storageDir,
    isMissingFile,
    respond,
    authorized,
    readBody,
    readState,
  } = ctx;
  const file = path.join(storageDir, "native-state.json"),
    reports = archive(storageDir, isMissingFile);
  let queue = Promise.resolve(),
    busy = false;
  const lock = (fn) => {
    const promise = queue.then(fn, fn);
    queue = promise.then(
      () => {},
      () => {},
    );
    return promise;
  };
  const blank = () => ({
    revision: 0,
    policies: [],
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
  function read() {
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      if (
        !value ||
        !Array.isArray(value.policies) ||
        !Array.isArray(value.jobs)
      )
        throw new Error("原生观测状态损坏；停止写入");
      return value;
    } catch (e) {
      if (isMissingFile(e, file)) return blank();
      throw e;
    }
  }
  function save(s) {
    fs.mkdirSync(storageDir, { recursive: true });
    fs.writeFileSync(file + ".tmp", JSON.stringify(s), { mode: 0o600 });
    fs.renameSync(file + ".tmp", file);
  }
  function route(method, suffix, admin, fn) {
    server.route(method, BASE + suffix, async (req, res) => {
      if (admin && !authorized(req, res)) return;
      try {
        await lock(async () => {
          const s = read();
          await fn(req, res, s);
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
    if (
      j.operation === "route" &&
      !tools.includes("nexttrace") &&
      !tools.includes("traceroute")
    )
      return "测量端缺少路径工具";
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
  function finish(s, j, data, source = j.source) {
    reports.append({
      id: j.id,
      nodeUuid: j.nodeUuid,
      policyId: j.policyId,
      completedAt: new Date().toISOString(),
      operation: j.operation,
      target: j.target,
      source,
      executor: j.executor,
      direction: j.direction,
      pairId: j.pairId || "",
      fingerprint: M.fingerprint({ ...j, source }),
      options: j.options,
      data,
    });
    s.jobs = s.jobs.filter((x) => x.id !== j.id);
  }
  function enqueue(s, p, uuid) {
    if (s.jobs.filter((x) => x.policyId === p.id && x.nodeUuid === uuid).length)
      return;
    for (const job of M.planJobs(p, uuid, s.endpoints[uuid], s.probes)) {
      if (s.jobs.length >= 2000) throw new Error("原生队列达到上限");
      s.jobs.push({
        ...job,
        id: crypto.randomUUID(),
        phase: "queued",
        queuedAt: Date.now(),
        expiresAt: Date.now() + 20 * 60000,
      });
    }
  }
  function safe(s) {
    return {
      ...s,
      probes: Object.entries(s.probes).map(([id, p]) => {
        const { tokenHash, ...rest } = p;
        return { id, ...rest, online: online(s, "probe:" + id) };
      }),
      jobs: s.jobs.map((j) => ({
        id: j.id,
        nodeUuid: j.nodeUuid,
        policyId: j.policyId,
        operation: j.operation,
        direction: j.direction,
        phase: j.phase,
        target: j.target,
        source: j.source,
      })),
      provider: {
        ...s.provider,
        probes: s.provider.probes
          .filter((x) => x.location?.country === "CN")
          .map((x) => ({ location: x.location, tags: x.tags })),
      },
    };
  }
  route("GET", "/catalog", true, async (req, res, s) => {
    void tick(true);
    respond(res, 200, {
      ...safe(s),
      websites: M.WEBSITES,
      timezones: M.TIMEZONES,
      retention: { detailDays: 7, summaryDays: 90 },
      nextRuns: s.policies.map((p) => ({ id: p.id, at: p.nextAt })),
    });
  });
  route("GET", "/nodes/:uuid/reports", true, async (req, res, s) => {
    const id = String(req.url).split("/").slice(-2)[0];
    if (!UUID.test(id)) throw new Error("节点标识无效");
    respond(res, 200, {
      ...reports.history(id),
      jobs: safe(s).jobs.filter((j) => j.nodeUuid === id),
      policies: s.policies.filter((p) =>
        M.members(p, s.inventory).includes(id),
      ),
    });
  });
  route("POST", "/preview", true, async (req, res, s) => {
    const p = M.normalizePolicy(readBody(req));
    respond(res, 200, {
      members: M.members(p, s.inventory).map((id) => ({
        id,
        jobs: M.planJobs(p, id, s.endpoints[id], s.probes).map((j) => ({
          operation: j.operation,
          target: j.target,
          direction: j.direction,
          source: j.source,
          ready: !coverage(s, j),
          reason: coverage(s, j),
        })),
      })),
      nextAt: M.next(p.timing),
      trafficAt1GbpsGB:
        p.kind === "speed" ? (p.seconds * 2 * p.streams.length) / 8 : 0,
    });
  });
  route("POST", "/policies", true, async (req, res, s) => {
    const input = readBody(req);
    if (input.revision !== s.revision) {
      respond(res, 409, { error: "配置已被其他窗口修改，请刷新后重试" });
      return;
    }
    const p = M.normalizePolicy(input);
    if (s.policies.length >= 100 && !s.policies.some((x) => x.id === p.id))
      throw new Error("最多 100 个集中方案");
    if (p.sources.some((id) => !s.probes[id]))
      throw new Error("所选大陆探针不存在");
    p.nextAt = M.next(p.timing);
    if (!p.inherit) {
      p.clients = M.members(p, s.inventory);
      p.groups = [];
    }
    if (!input.id) {
      const comparable = (x) =>
        JSON.stringify({
          ...x,
          id: undefined,
          nextAt: undefined,
          clients: x.clients.slice().sort(),
          groups: x.groups.slice().sort(),
          sources: x.sources.slice().sort(),
          sites: x.sites.slice().sort(),
        });
      const existing = s.policies.find((x) => comparable(x) === comparable(p));
      if (existing) p.id = existing.id;
    }
    if (!p.enabled) s.jobs = s.jobs.filter((j) => j.policyId !== p.id);
    const i = s.policies.findIndex((x) => x.id === p.id);
    if (i < 0) s.policies.push(p);
    else s.policies[i] = p;
    s.revision++;
    save(s);
    respond(res, 200, { policy: p });
  });
  route("POST", "/policies/:id/run", true, async (req, res, s) => {
    const id = String(req.url).split("/").slice(-2)[0],
      p = s.policies.find((x) => x.id === id);
    if (!p || !p.enabled) throw new Error("计划不存在或已暂停");
    for (const uuid of M.members(p, s.inventory)) enqueue(s, p, uuid);
    save(s);
    respond(res, 202, { ok: true });
  });
  route("DELETE", "/policies/:id", true, async (req, res, s) => {
    const id = String(req.url).split("/").pop();
    s.policies = s.policies.filter((x) => x.id !== id);
    s.jobs = s.jobs.filter((x) => x.policyId !== id);
    s.revision++;
    save(s);
    respond(res, 200, { ok: true });
  });
  route("POST", "/endpoints", true, async (req, res, s) => {
    const input = readBody(req);
    if (!UUID.test(input.nodeUuid || "")) throw new Error("节点标识无效");
    const port = Number(input.port || 25201);
    if (!Number.isInteger(port) || port < 20000 || port > 40000)
      throw new Error("测速端口需在 20000–40000");
    s.endpoints[input.nodeUuid] = { address: M.host(input.address), port };
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
    for (const p of s.policies) {
      p.sources = p.sources.filter((x) => x !== id);
      if (
        !p.sources.length &&
        (p.kind === "speed" || (p.kind === "routes" && !p.publicSources))
      )
        p.enabled = false;
    }
    for (const j of s.jobs.slice())
      if (j.executor === "probe:" + id)
        finish(s, j, {
          kind: j.operation === "benchmark" ? "speed" : "route",
          state: "missing",
          diagnostic: "探针已撤销",
        });
    s.revision++;
    save(s);
    respond(res, 200, { ok: true });
  });
  for (const role of ["node", "probe"]) {
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
          tools: Array.isArray(b.tools)
            ? b.tools.filter((x) =>
                [
                  "curl",
                  "nexttrace",
                  "traceroute",
                  "mtr",
                  "iperf3",
                  "openssl",
                ].includes(x),
              )
            : [],
          authScheme: ["oaep", "pkcs1"].includes(b.authScheme)
            ? b.authScheme
            : "unavailable",
        };
        save(s);
        respond(res, 200, { ok: true });
      },
    );
    route("GET", `/workers/${role}/:id/poll`, false, async (req, res, s) => {
      const w = auth(req, res, s);
      if (!w) return;
      const legacy = readState(),
        heavy = legacy.tasks.some(
          (j) =>
            j.status === "running" &&
            [
              "speedtest",
              "throughput",
              "tcpquality-all",
              "tcpquality-report",
              "tcpquality-intl",
              "tcpquality-intl-report",
            ].includes(j.mode),
        );
      const occupied = s.jobs.filter((j) =>
        ["listening", "ready", "running", "submitting", "provider"].includes(
          j.phase,
        ),
      );
      let task = null;
      for (const j of s.jobs) {
        if (
          j.phase === "queued" &&
          j.executor === w.key &&
          j.operation !== "benchmark" &&
          !occupied.some(
            (x) =>
              x.executor === w.key ||
              (x.operation === "benchmark" && x.nodeUuid === w.id),
          )
        ) {
          const problem = coverage(s, j);
          if (problem) {
            finish(s, j, {
              kind: j.operation,
              state: "missing",
              diagnostic: problem,
            });
            break;
          }
          j.phase = "running";
          j.expiresAt = Date.now() + 180000;
          task = { ...j };
          break;
        }
        if (
          j.operation === "benchmark" &&
          j.phase === "queued" &&
          w.key === "node:" + j.nodeUuid &&
          !heavy &&
          !occupied.some(
            (x) =>
              x.operation === "benchmark" ||
              x.executor === "node:" + j.nodeUuid ||
              x.executor === j.executor,
          ) &&
          online(s, j.executor)
        ) {
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
          j.phase = "running";
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
      save(s);
      respond(res, 200, {
        task,
        listeners: s.jobs
          .filter(
            (j) =>
              j.operation === "benchmark" &&
              j.nodeUuid === w.id &&
              ["listening", "ready", "running"].includes(j.phase),
          )
          .map((j) => j.id),
      });
    });
    route("POST", `/workers/${role}/:id/result`, false, async (req, res, s) => {
      const w = auth(req, res, s);
      if (!w) return;
      const b = readBody(req),
        j = s.jobs.find((x) => x.id === b.id);
      if (!j) {
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
          j.phase = "ready";
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
          kind = j.operation === "benchmark" ? "speed" : j.operation;
        M.validateResult(data, kind);
        finish(s, j, data, {
          ...j.source,
          runnerVersion: s.workers[w.key]?.version || "",
        });
      }
      save(s);
      respond(res, 200, { ok: true });
    });
  }
  async function tick(refreshProvider = false) {
    if (busy) return;
    busy = true;
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
            ip: n.ipv4 || n.ip_v4 || "",
          }));
      } catch (e) {
        error = String(e.message || e).slice(0, 200);
      }
      const actions = await lock(async () => {
        const s = read(),
          now = Date.now();
        if (inventory) {
          s.inventory = inventory;
          for (const n of inventory)
            if (
              !s.endpoints[n.uuid] &&
              n.ip &&
              require("./model.js").isHost(n.ip)
            )
              s.endpoints[n.uuid] = { address: n.ip, port: 25201 };
        }
        s.inventoryError = error;
        for (const j of s.jobs.slice())
          if (j.expiresAt < now)
            finish(s, j, {
              kind:
                j.operation === "benchmark"
                  ? "speed"
                  : j.operation === "globalping"
                    ? "route"
                    : j.operation,
              state: j.phase === "queued" ? "missing" : "failed",
              diagnostic:
                "任务超时：" + (coverage(s, j) || "测量或排队没有按期完成"),
            });
        for (const p of s.policies)
          if (p.enabled && p.nextAt <= now) {
            for (const uuid of M.members(p, s.inventory)) enqueue(s, p, uuid);
            p.nextAt = M.next(p.timing, now);
          }
        for (const j of s.jobs.slice())
          if (!j.target)
            finish(s, j, {
              kind: j.operation === "benchmark" ? "speed" : "route",
              state: "missing",
              diagnostic:
                j.direction === "VPS→大陆"
                  ? "大陆探针未声明可达公网地址（NAT 后不推断反向路径）"
                  : "请设置此 VPS 的可达公网地址",
            });
        const hour = Math.floor(now / 3600000);
        if (s.provider.hour !== hour) {
          s.provider.hour = hour;
          s.provider.used = 0;
        }
        const out = [];
        for (const j of s.jobs) {
          if (out.length >= 3) break;
          if (j.phase === "provider") {
            out.push({
              id: j.id,
              measurementId: j.measurementId,
              operation: "poll",
            });
          } else if (
            j.operation === "globalping" &&
            j.phase === "queued" &&
            s.provider.used < 120 &&
            s.provider.blockedUntil <= now
          ) {
            j.phase = "submitting";
            s.provider.used++;
            out.push({ id: j.id, operation: "create", job: { ...j } });
          }
        }
        if (
          (refreshProvider ||
            s.policies.some((p) => p.kind === "routes" && p.publicSources)) &&
          s.provider.checkedAt < now - 10 * 60000
        ) {
          s.provider.checkedAt = now;
          out.push({ operation: "probes" });
        }
        for (const n of s.inventory) reports.cleanup(n.uuid, now);
        save(s);
        return out;
      });
      await Promise.all(
        actions.map(async (a) => {
          let result, e;
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
          await lock(async () => {
            const s = read();
            if (a.operation === "probes") {
              if (Array.isArray(result)) {
                s.provider.probes = result
                  .filter((p) => p.location?.country === "CN")
                  .slice(0, 2500);
                s.provider.error = "";
              } else s.provider.error = String(e?.message || "目录不可用");
              save(s);
              return;
            }
            const j = s.jobs.find((x) => x.id === a.id);
            if (!j) return;
            if (e) {
              s.provider.error = String(e.message || e);
              if (e.rateLimited) {
                s.provider.blockedUntil = Date.now() + 3600000;
                if (a.operation === "create") j.phase = "queued";
              } else if (a.operation === "create")
                finish(s, j, {
                  kind: "route",
                  state: e.noCoverage ? "missing" : "failed",
                  diagnostic:
                    "公共测量提交失败，未自动重复提交：" + s.provider.error,
                });
            } else if (a.operation === "create") {
              if (!/^[a-zA-Z0-9_-]{1,80}$/.test(result.id || ""))
                finish(s, j, {
                  kind: "route",
                  state: "missing",
                  diagnostic: "公共测量没有返回可用测量 ID",
                });
              else {
                j.measurementId = result.id;
                j.phase = "provider";
                j.expiresAt = Date.now() + 180000;
              }
            } else if (result.status === "finished") {
              const row = G.normalize(j, result)[0];
              finish(s, j, row.data, row.source);
            }
            save(s);
          });
        }),
      );
    } catch (e) {
      console.error("Aster native scheduler:", String(e.message || e));
    } finally {
      busy = false;
    }
  }
  void tick();
  return { tick, read, lock, reports, enqueue };
}
module.exports = { registerNativeController, BASE };
