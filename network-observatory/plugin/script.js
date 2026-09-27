const server = require("server");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  API_BASE,
  HISTORY_LIMIT,
  MODES,
  createDueRuns,
  normalizeConfig,
  parseProbeOutput,
  readAdminPrincipal,
} = require("./src/model.js");

const storageDir = __storageDir__;
const statePath = path.join(storageDir, "state.json");
const TASK_LEASE_MS = 12 * 60_000;
const TASK_QUEUE_TTL_MS = 20 * 60_000;
const MAX_TASK_ATTEMPTS = 3;
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

function readState() {
  try {
    const saved = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const nodes = {};
    if (isObject(saved.nodes)) {
      for (const [uuid, node] of Object.entries(saved.nodes)) {
        if (!/^[0-9a-f-]{36}$/i.test(uuid) || !isObject(node) || !/^[0-9a-f]{64}$/i.test(node.tokenHash)) continue;
        nodes[uuid] = {
          tokenHash: node.tokenHash,
          tokenIssuedAt: typeof node.tokenIssuedAt === "string" ? node.tokenIssuedAt : "",
          lastSeenAt: typeof node.lastSeenAt === "string" ? node.lastSeenAt : "",
        };
      }
    }
    const tasks = Array.isArray(saved.tasks) ? saved.tasks.filter((task) =>
      isObject(task) && typeof task.taskId === "string" &&
      typeof task.scheduleId === "string" && typeof task.nodeUuid === "string" &&
      MODES.includes(task.mode) && ["queued", "running"].includes(task.status),
    ).slice(0, 100) : [];
    return {
      config: normalizeConfig(saved.config),
      nodes,
      tasks,
      history: Array.isArray(saved.history) ? saved.history.slice(-HISTORY_LIMIT) : [],
      updatedAt: typeof saved.updatedAt === "string" ? saved.updatedAt : "",
    };
  } catch {
    return { config: { schedules: [] }, nodes: {}, tasks: [], history: [], updatedAt: "" };
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

function appendHistory(state, record) {
  state.history.push(record);
  state.history = state.history.slice(-HISTORY_LIMIT);
}

function finishFailedTask(state, task, message, status = "timeout") {
  appendHistory(state, {
    completedAt: new Date().toISOString(),
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
  };
}

function queueSchedule(state, schedule) {
  if (state.tasks.length > 0) throw new Error("已有节点检测任务排队或运行");
  if (!state.nodes[schedule.clients[0]]) throw new Error("请先为所选节点生成并安装网络观测凭证");
  state.tasks.push(createTask(schedule));
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    await withStateLock(async () => {
      const state = readState();
      const now = Date.now();
      expireTasks(state, now);
      const due = createDueRuns(state.config, now);
      if (state.tasks.length > 0 && due.due.length > 0) {
        state.config.schedules = due.config.schedules.map((item) => item.id === due.due[0].id
          ? { ...item, nextRunAt: now + 60_000 }
          : item);
      } else if (due.due.length > 0) {
        state.config = due.config;
        try {
          queueSchedule(state, due.due[0]);
        } catch (error) {
          finishFailedTask(state, createTask(due.due[0]), String(error?.message || error), "failed");
        }
      }
      state.updatedAt = new Date().toISOString();
      writeState(state);
    });
  } catch (error) {
    console.error("Aster network observatory scheduler failed:", error);
  } finally {
    busy = false;
  }
}

function safeNodeList(nodes) {
  return Object.entries(nodes).map(([uuid, node]) => ({
    uuid,
    tokenIssuedAt: node.tokenIssuedAt,
    lastSeenAt: node.lastSeenAt,
  }));
}

function load() {
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
      const wasRegistered = Boolean(state.nodes[uuid]);
      state.nodes[uuid] = {
        tokenHash: hashToken(token),
        tokenIssuedAt: new Date().toISOString(),
        lastSeenAt: state.nodes[uuid]?.lastSeenAt || "",
      };
      if (!wasRegistered) {
        state.config.schedules = state.config.schedules.map((schedule) => schedule.clients.includes(uuid) && !schedule.enabled
          ? { ...schedule, enabled: true, nextRunAt: Date.now() + schedule.intervalMinutes * 60_000 }
          : schedule);
      }
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
        ? { ...schedule, enabled: false }
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
      currentNode.lastSeenAt = new Date().toISOString();
      current.updatedAt = currentNode.lastSeenAt;
      writeState(current);
      respond(res, 200, { ok: true, uuid: identity.uuid });
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
      let task = current.tasks.find((item) => item.nodeUuid === identity.uuid && item.status === "queued");
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
