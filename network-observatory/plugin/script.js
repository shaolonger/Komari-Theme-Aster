const server = require("server");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  API_BASE,
  HISTORY_LIMIT,
  MODES,
  normalizeConfig,
  parseProbeOutput,
  readAdminPrincipal,
} = require("./src/model.js");

const { normalizeInventory, reconcilePolicies } = require("./src/policies.js");
const { registerAdminRoutes } = require("./src/admin.js");
const storageDir = __storageDir__;
const statePath = path.join(storageDir, "state.json");
const TASK_LEASE_MS = 12 * 60_000;
const TASK_QUEUE_TTL_MS = 20 * 60_000;
const MAX_TASK_ATTEMPTS = 3;
const GLOBAL_CONCURRENCY = 4;
const QUEUE_LIMIT = 2000;
let busy = false;
let stateQueue = Promise.resolve();

function withStateLock(operation) {
  const result = stateQueue.then(operation, operation);
  stateQueue = result.then(() => undefined, () => undefined);
  return result;
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isMissingFile(error, file) {
  if (error?.code === "ENOENT") return true;
  // Komari 1.4.3 exposes a Go PathError. Its Err serializes as 2 in logs,
  // but is an object in JavaScript, so strict numeric comparison does not work.
  const pathError = error?.value;
  if (pathError?.Path !== file || !["lstat", "open"].includes(pathError?.Op)) return false;
  try {
    // Unlike readFileSync, Komari's accessSync gives missing files a Node-style code.
    fs.accessSync(file);
  } catch (probeError) {
    return probeError?.code === "ENOENT";
  }
  return false;
}

function readState() {
  try {
    const saved = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (!isObject(saved) || !isObject(saved.config) || !Array.isArray(saved.config.schedules)) {
      throw new Error("网络观测状态文件格式无效；已停止写入以保护旧数据");
    }
    const nodes = {};
    if (isObject(saved.nodes)) {
      for (const [uuid, node] of Object.entries(saved.nodes)) {
        if (!/^[0-9a-f-]{36}$/i.test(uuid) || !isObject(node) || !/^[0-9a-f]{64}$/i.test(node.tokenHash)) continue;
        nodes[uuid] = {
          tokenHash: node.tokenHash,
          tokenIssuedAt: typeof node.tokenIssuedAt === "string" ? node.tokenIssuedAt : "",
          lastSeenAt: typeof node.lastSeenAt === "string" ? node.lastSeenAt : "",
          capabilities: Array.isArray(node.capabilities) ? node.capabilities.filter((v) => ["curl", "nexttrace", "iperf3", "tcpquality", "timeout"].includes(v)) : null,
          runnerVersion: typeof node.runnerVersion === "string" ? node.runnerVersion.slice(0, 30) : "",
          capabilitiesAt: typeof node.capabilitiesAt === "string" ? node.capabilitiesAt : "",
        };
      }
    }
    if (Array.isArray(saved.tasks) && saved.tasks.length > QUEUE_LIMIT) throw new Error("已保存任务队列超出限制，请先检查数据目录");
    const tasks = Array.isArray(saved.tasks) ? saved.tasks.filter((task) =>
      isObject(task) && typeof task.taskId === "string" &&
      typeof task.scheduleId === "string" && typeof task.nodeUuid === "string" &&
      MODES.includes(task.mode) && ["queued", "running"].includes(task.status),
    ) : [];
    return {
      config: normalizeConfig(saved.config),
      nodes,
      tasks,
      policies: Array.isArray(saved.policies) ? saved.policies : [],
      inventory: Array.isArray(saved.inventory) ? saved.inventory : [],
      inventoryAt: saved.inventoryAt || "",
      inventoryError: saved.inventoryError || "",
      history: Array.isArray(saved.history) ? saved.history.slice(-HISTORY_LIMIT) : [],
      updatedAt: typeof saved.updatedAt === "string" ? saved.updatedAt : "",
    };
  } catch (error) {
    if (!isMissingFile(error, statePath)) throw error;
    return { config: { schedules: [] }, nodes: {}, tasks: [], history: [], policies: [], inventory: [], inventoryAt: "", inventoryError: "", updatedAt: "" };
  }
}

function writeState(state) {
  fs.mkdirSync(storageDir, { recursive: true });
  const temporary = `${statePath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(temporary, statePath);
}

function respond(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function authorized(req, res) {
  if (readAdminPrincipal(req.context?.principal)) return true;
  respond(res, req.context?.principal?.type === "anonymous" ? 401 : 403, { error: "管理员身份必需" });
  return false;
}

function readBody(req) {
  if (!req.body || req.body.length > 131_072) throw new Error("请求内容为空或超过 128 KiB");
  return JSON.parse(req.body);
}

function apiPath(req) {
  return String(req.url || "").split("?", 1)[0];
}

function nodeUuidFromRequest(req, action) {
  const escapedBase = API_BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escapedBase}/nodes/([^/]+)/${action}$`).exec(apiPath(req));
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

function bearerToken(req) {
  const raw = req.headers?.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  const match = typeof header === "string" ? /^Bearer ([0-9a-f]{64})$/i.exec(header.trim()) : null;
  return match?.[1]?.toLowerCase() ?? "";
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function authenticateNode(req, res, state, action) {
  const uuid = nodeUuidFromRequest(req, action);
  const node = state.nodes[uuid];
  const token = bearerToken(req);
  if (!node || !token) {
    respond(res, 401, { error: "节点凭证无效" });
    return null;
  }
  const expected = Buffer.from(node.tokenHash, "hex");
  const actual = Buffer.from(hashToken(token), "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    respond(res, 401, { error: "节点凭证无效" });
    return null;
  }
  return { uuid, node };
}

function nodeHistory(state, uuid) {
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) throw new Error("节点 UUID 无效");
  const file = path.join(storageDir, `history-${uuid}.json`);
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { if (!isMissingFile(error, file)) throw error; return state.history.filter((row) => row.nodeUuid === uuid); }
}

function appendHistory(state, record) {
  const rows = [...nodeHistory(state, record.nodeUuid), record].slice(-HISTORY_LIMIT);
  let bytes = 0;
  let start = rows.length;
  while (start > 0) {
    const size = Buffer.byteLength(JSON.stringify(rows[start - 1]), "utf8");
    if (bytes + size > 2 * 1024 * 1024) break;
    bytes += size;
    start--;
  }
  const file = path.join(storageDir, `history-${record.nodeUuid}.json`);
  fs.mkdirSync(storageDir, { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(rows.slice(start)), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
  state.history.push(record);
  state.history = state.history.slice(-HISTORY_LIMIT);
}

function finishFailedTask(state, task, message, status = "timeout") {
  appendHistory(state, {
    completedAt: new Date().toISOString(),
    taskId: task.taskId,
    runnerVersion: state.nodes[task.nodeUuid]?.runnerVersion || "",
    catalogVersion: task.catalogVersion || "",
    mode: task.mode,
    target: task.target,
    status,
    exitCode: -1,
    rawOutput: message.slice(0, 48_000),
    scheduleId: task.scheduleId,
    nodeUuid: task.nodeUuid,
    nodeName: task.nodeName || task.nodeUuid,
    carrier: task.carrier,
    region: task.region,
  });
}

function expireTasks(state, now) {
  const remaining = [];
  for (const task of state.tasks) {
    if (task.status === "running" && Number(task.leaseUntil) <= now) {
      if (Number(task.attempts) >= MAX_TASK_ATTEMPTS) {
        finishFailedTask(state, task, "节点探测任务多次失联，已停止重试。");
        continue;
      }
      task.status = "queued";
      task.startedAt = 0;
      task.leaseUntil = 0;
    }
    if (task.status === "queued" && now - Number(task.queuedAt) > TASK_QUEUE_TTL_MS) {
      finishFailedTask(state, task, "20 分钟内没有收到节点探测器的领取请求。节点可能离线或探测器尚未安装。");
      continue;
    }
    remaining.push(task);
  }
  state.tasks = remaining;
}

function createTask(schedule, nodeName = "") {
  return {
    taskId: crypto.randomUUID(),
    scheduleId: schedule.id,
    mode: schedule.mode,
    target: schedule.target,
    port: schedule.port,
    nodeUuid: schedule.clients[0],
    nodeName: nodeName || schedule.clients[0],
    carrier: schedule.carrier,
    region: schedule.region,
    status: "queued",
    queuedAt: Date.now(),
    startedAt: 0,
    leaseUntil: 0,
    attempts: 0,
    catalogVersion: schedule.catalogVersion || "",
  };
}

function queueSchedule(state, schedule) {
  if (state.tasks.some((task) => task.scheduleId === schedule.id)) throw new Error("已有节点检测任务排队或运行，请等待完成");
  if (state.tasks.length >= QUEUE_LIMIT) throw new Error("任务队列已满，请稍后重试");
  if (!state.nodes[schedule.clients[0]]) throw new Error("请先为所选节点生成并安装网络观测凭证");
  state.tasks.push(createTask(schedule));
}

function requiredTool(mode) {
  return mode === "https" ? "curl" : mode === "route" ? "nexttrace" : mode === "throughput" ? "iperf3" : "tcpquality";
}

function nodeReady(node, mode, now) {
  return node && now - Date.parse(node.lastSeenAt || "") < 90_000 &&
    (!node.capabilities || (node.capabilities.includes("timeout") && node.capabilities.includes(requiredTool(mode))));
}

async function syncInventory() {
  try {
    const inventory = normalizeInventory(await server.call("admin:listClients"));
    await withStateLock(async () => {
      const state = readState();
      reconcilePolicies(state, inventory);
      state.inventory = inventory;
      state.inventoryAt = new Date().toISOString();
      state.inventoryError = "";
      writeState(state);
    });
  } catch (error) {
    await withStateLock(async () => {
      const state = readState();
      state.inventoryError = `无法同步 Komari 分组：${String(error.message || error).slice(0, 180)}`;
      writeState(state);
    });
  }
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    await syncInventory();
    await withStateLock(async () => {
      const state = readState();
      const now = Date.now();
      expireTasks(state, now);
      const due = state.config.schedules.filter((plan) => plan.enabled && plan.nextRunAt <= now)
        .sort((a, b) => a.nextRunAt - b.nextRunAt);
      let queued = 0;
      for (const plan of due) {
        if (queued >= 32 || state.tasks.length >= QUEUE_LIMIT) break;
        if (!nodeReady(state.nodes[plan.clients[0]], plan.mode, now) || state.tasks.some((task) => task.scheduleId === plan.id)) continue;
        queueSchedule(state, plan);
        plan.nextRunAt = now + plan.intervalMinutes * 60_000;
        queued++;
      }
      state.updatedAt = new Date().toISOString();
      writeState(state);
    });
  } catch (error) {
    console.error("Aster network observatory scheduler failed:", error);
  } finally { busy = false; }
}

function safeNodeList(nodes) {
  return Object.entries(nodes).map(([uuid, node]) => ({
    uuid,
    tokenIssuedAt: node.tokenIssuedAt,
    lastSeenAt: node.lastSeenAt,
    capabilities: node.capabilities, runnerVersion: node.runnerVersion, capabilitiesAt: node.capabilitiesAt,
  }));
}

function load() {
  registerAdminRoutes({ server, readState, writeState, withStateLock, authorized, readBody, respond,
    nodeHistory, safeNodeList, syncInventory, queueSchedule, createTask, requiredTool });
  server.route("GET", `${API_BASE}/status`, async (req, res) => {
    if (!authorized(req, res)) return;
    await withStateLock(async () => {
      const state = readState();
      respond(res, 200, {
        config: state.config,
        pending: state.tasks.length,
        history: state.history.slice(-100).reverse(),
        updatedAt: state.updatedAt,
        modes: MODES,
        intervals: [1, 5, 15, 60, 360, 720, 1440],
        registeredNodes: safeNodeList(state.nodes),
      });
    });
  });

  server.route("POST", `${API_BASE}/nodes/:uuid/token`, async (req, res) => {
    if (!authorized(req, res)) return;
    const uuid = nodeUuidFromRequest(req, "token");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)) {
      respond(res, 400, { error: "Komari 节点 UUID 无效" });
      return;
    }
    await withStateLock(async () => {
      const state = readState();
      const token = crypto.randomBytes(32).toString("hex");
      state.nodes[uuid] = {
        ...state.nodes[uuid],
        tokenHash: hashToken(token),
        tokenIssuedAt: new Date().toISOString(),
        lastSeenAt: "",
      };
      state.updatedAt = new Date().toISOString();
      writeState(state);
      respond(res, 201, { uuid, token });
    });
  });

  server.route("DELETE", `${API_BASE}/nodes/:uuid/token`, async (req, res) => {
    if (!authorized(req, res)) return;
    const uuid = nodeUuidFromRequest(req, "token");
    await withStateLock(async () => {
      const state = readState();
      delete state.nodes[uuid];
      state.config.schedules = state.config.schedules.map((schedule) => schedule.clients.includes(uuid)
        ? { ...schedule, enabled: false, customized: Boolean(schedule.sourcePolicy), revision: schedule.revision + 1 }
        : schedule);
      state.tasks = state.tasks.filter((task) => {
        if (task.nodeUuid !== uuid) return true;
        finishFailedTask(state, task, "节点网络观测凭证已撤销。", "failed");
        return false;
      });
      state.updatedAt = new Date().toISOString();
      writeState(state);
      respond(res, 200, { registeredNodes: safeNodeList(state.nodes), config: state.config });
    });
  });

  server.route("POST", `${API_BASE}/nodes/:uuid/verify`, async (req, res) => {
    const state = readState();
    const identity = authenticateNode(req, res, state, "verify");
    if (!identity) return;
    await withStateLock(async () => {
      const current = readState();
      const currentNode = current.nodes[identity.uuid];
      if (!currentNode || currentNode.tokenHash !== identity.node.tokenHash) {
        respond(res, 401, { error: "节点凭证无效" });
        return;
      }
      respond(res, 200, { ok: true, uuid: identity.uuid });
    });
  });

  server.route("POST", `${API_BASE}/nodes/:uuid/heartbeat`, async (req, res) => {
    const identity = authenticateNode(req, res, readState(), "heartbeat");
    if (!identity) return;
    let input;
    try { input = readBody(req); } catch (error) { respond(res, 400, { error: String(error.message) }); return; }
    await withStateLock(async () => {
      const state = readState(), node = state.nodes[identity.uuid];
      if (!node || node.tokenHash !== identity.node.tokenHash) { respond(res, 401, { error: "节点凭证无效" }); return; }
      if (!Array.isArray(input.capabilities)) { respond(res, 400, { error: "工具状态格式无效" }); return; }
      node.capabilities = [...new Set(input.capabilities.filter((name) => ["curl", "nexttrace", "iperf3", "tcpquality", "timeout"].includes(name)))];
      node.runnerVersion = typeof input.runnerVersion === "string" ? input.runnerVersion.slice(0, 30) : "";
      node.lastSeenAt = node.capabilitiesAt = new Date().toISOString();
      writeState(state); respond(res, 200, { ok: true });
    });
  });

  server.route("GET", `${API_BASE}/nodes/:uuid/poll`, async (req, res) => {
    const state = readState();
    const identity = authenticateNode(req, res, state, "poll");
    if (!identity) return;
    await withStateLock(async () => {
      const current = readState();
      const currentNode = current.nodes[identity.uuid];
      if (!currentNode || currentNode.tokenHash !== identity.node.tokenHash) {
        respond(res, 401, { error: "节点凭证无效" });
        return;
      }
      const now = Date.now();
      currentNode.lastSeenAt = new Date(now).toISOString();
      expireTasks(current, now);
      const active = current.tasks.filter((item) => item.status === "running");
      let task = active.length < GLOBAL_CONCURRENCY && !active.some((item) => item.nodeUuid === identity.uuid)
        ? current.tasks.find((item) => item.nodeUuid === identity.uuid && item.status === "queued" &&
          !(item.mode === "throughput" && active.some((running) => running.mode === "throughput" && running.target === item.target && running.port === item.port))) : null;
      if (task) {
        task.status = "running";
        task.startedAt = now;
        task.leaseUntil = now + TASK_LEASE_MS;
        task.attempts = Number(task.attempts || 0) + 1;
      }
      current.updatedAt = currentNode.lastSeenAt;
      writeState(current);
      respond(res, 200, {
        task: task ? {
          taskId: task.taskId,
          scheduleId: task.scheduleId,
          mode: task.mode,
          target: task.target,
          port: task.port,
        } : null,
      });
    });
  });

  server.route("POST", `${API_BASE}/nodes/:uuid/result`, async (req, res) => {
    const state = readState();
    const identity = authenticateNode(req, res, state, "result");
    if (!identity) return;
    let input;
    try {
      input = readBody(req);
    } catch (error) {
      respond(res, 400, { error: String(error?.message || error) });
      return;
    }
    if (!isObject(input) || typeof input.taskId !== "string" || typeof input.output !== "string" || input.output.length > 64_000) {
      respond(res, 400, { error: "节点结果格式无效或超出大小限制" });
      return;
    }
    await withStateLock(async () => {
      const current = readState();
      const currentNode = current.nodes[identity.uuid];
      if (!currentNode || currentNode.tokenHash !== identity.node.tokenHash) {
        respond(res, 401, { error: "节点凭证无效" });
        return;
      }
      const index = current.tasks.findIndex((task) => task.taskId === input.taskId && task.nodeUuid === identity.uuid);
      if (index < 0 || current.tasks[index].status !== "running") {
        respond(res, 409, { error: "任务不存在、已完成或不属于此节点" });
        return;
      }
      const task = current.tasks[index];
      try {
        const record = parseProbeOutput(input.output, task);
        if (record.mode !== task.mode || record.target !== task.target) throw new Error("节点返回的检测类型或目标与计划不匹配");
        record.completedAt = new Date().toISOString();
        record.taskId = task.taskId;
        record.runnerVersion = currentNode.runnerVersion || "";
        record.catalogVersion = task.catalogVersion || "";
        record.scheduleId = task.scheduleId;
        record.nodeUuid = task.nodeUuid;
        record.nodeName = task.nodeName;
        record.carrier = task.carrier;
        record.region = task.region;
        appendHistory(current, record);
      } catch (error) {
        finishFailedTask(current, task, `节点结果校验失败：${String(error?.message || error)}`, "failed");
      }
      current.tasks.splice(index, 1);
      currentNode.lastSeenAt = new Date().toISOString();
      current.updatedAt = currentNode.lastSeenAt;
      writeState(current);
      respond(res, 200, { ok: true });
    });
  });

  server.route("PUT", `${API_BASE}/config`, async (req, res) => {
    if (!authorized(req, res)) return;
    try {
      const incoming = normalizeConfig(readBody(req));
      await withStateLock(async () => {
        const current = readState();
        if (current.policies.length) { respond(res, 409, { error: "已有方案继承，请更新主题并在实例详情页编辑计划" }); return; }
        for (const schedule of incoming.schedules) {
          if (schedule.enabled && !current.nodes[schedule.clients[0]]) {
            throw new Error(`计划“${schedule.name}”的节点尚未注册本地探测器`);
          }
        }
        const oldById = new Map(current.config.schedules.map((item) => [item.id, item]));
        incoming.schedules = incoming.schedules.map((item) => ({
          ...item,
          nextRunAt: oldById.get(item.id)?.nextRunAt || Date.now() + item.intervalMinutes * 60_000,
        }));
        current.config = incoming;
        current.updatedAt = new Date().toISOString();
        writeState(current);
        respond(res, 200, { config: current.config });
      });
    } catch (error) {
      respond(res, 400, { error: String(error?.message || error) });
    }
  });

  server.route("POST", `${API_BASE}/run/:id`, async (req, res) => {
    if (!authorized(req, res)) return;
    try {
      const scheduleId = decodeURIComponent(apiPath(req).split("/").pop());
      await withStateLock(async () => {
        const state = readState();
        const schedule = state.config.schedules.find((item) => item.id === scheduleId && item.enabled);
        if (!schedule) throw new Error("未找到已启用的计划");
        queueSchedule(state, schedule);
        state.updatedAt = new Date().toISOString();
        writeState(state);
        respond(res, 202, { task: { taskId: state.tasks[state.tasks.length - 1].taskId, status: "queued" } });
      });
    } catch (error) {
      respond(res, 400, { error: String(error?.message || error) });
    }
  });

  server.cron("* * * * *", () => { void tick(); });
  void tick();
}
