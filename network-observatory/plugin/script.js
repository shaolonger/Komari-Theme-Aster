const server = require("server");
const fs = require("fs");
const path = require("path");
const {
  API_BASE,
  HISTORY_LIMIT,
  MODES,
  buildProbeCommand,
  createDueRuns,
  normalizeConfig,
  normalizeSchedule,
  parseProbeOutput,
  readAdminPrincipal,
} = require("./src/model.js");

const storageDir = __storageDir__;
const statePath = path.join(storageDir, "state.json");
let busy = false;
let stateQueue = Promise.resolve();

function withStateLock(operation) {
  const result = stateQueue.then(operation, operation);
  stateQueue = result.then(() => undefined, () => undefined);
  return result;
}

function readState() {
  try {
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return {
      config: normalizeConfig(state.config),
      pending: Array.isArray(state.pending) ? state.pending.slice(0, 500) : [],
      history: Array.isArray(state.history) ? state.history.slice(-HISTORY_LIMIT) : [],
      updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : "",
    };
  } catch {
    return { config: { schedules: [] }, pending: [], history: [], updatedAt: "" };
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

function appendHistory(state, record) {
  state.history.push(record);
  state.history = state.history.slice(-HISTORY_LIMIT);
}

async function collectFinished(state) {
  const pending = [];
  for (const task of state.pending) {
    if (Date.now() - task.startedAt > 20 * 60_000) {
      appendHistory(state, {
        completedAt: new Date().toISOString(),
        mode: task.mode,
        target: task.target,
        status: "timeout",
        exitCode: -1,
        rawOutput: "20 分钟内没有收到节点结果。节点可能离线，或探测工具仍在运行。",
        scheduleId: task.scheduleId,
        nodeUuid: task.nodeUuid,
        nodeName: task.nodeName,
        carrier: task.carrier,
        region: task.region,
      });
      continue;
    }
    try {
      const results = await server.call("admin:getTaskResultsByTaskId", { task_id: task.taskId });
      const found = Array.isArray(results) ? results.find((item) => item.client === task.nodeUuid) : null;
      if (!found) {
        pending.push(task);
        continue;
      }
      const record = parseProbeOutput(found.result, task);
      record.completedAt = found.finished_at || found.created_at || record.completedAt;
      record.exitCode = record.exitCode || Number(found.exit_code || 0);
      if (Number(found.exit_code) !== 0 && record.status === "success") {
        record.status = "failed";
        record.exitCode = Number(found.exit_code);
      }
      appendHistory(state, record);
    } catch (error) {
      const message = String(error?.message || error);
      if (/not found|no results/i.test(message)) pending.push(task);
      else {
        appendHistory(state, {
          completedAt: new Date().toISOString(),
          mode: task.mode,
          target: task.target,
          status: "failed",
          exitCode: -1,
          rawOutput: message.slice(0, 1000),
          scheduleId: task.scheduleId,
          nodeUuid: task.nodeUuid,
          nodeName: task.nodeName,
          carrier: task.carrier,
          region: task.region,
        });
      }
    }
  }
  state.pending = pending;
}

async function dispatch(state, schedule) {
  if (state.pending.length > 0) throw new Error("已有网络检测任务运行或等待节点回报");
  const clientUuid = schedule.clients[0];
  const task = await server.call("admin:exec", {
    command: buildProbeCommand(schedule),
    clients: [clientUuid],
  });
  if (!task?.task_id) throw new Error("Komari 没有返回任务 ID");
  state.pending.push({
    taskId: task.task_id,
    startedAt: Date.now(),
    scheduleId: schedule.id,
    mode: schedule.mode,
    target: schedule.target,
    nodeUuid: clientUuid,
    nodeName: clientUuid,
    carrier: schedule.carrier,
    region: schedule.region,
  });
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    await withStateLock(async () => {
      const state = readState();
      await collectFinished(state);
      const due = createDueRuns(state.config);
      state.config = due.config;
      for (const schedule of due.due) {
        // Schedules target one node at a time. Extra nodes get their own plan
        // so expensive work is staggered and the next due plan is retained.
        if (state.pending.length > 0) {
          state.config.schedules = state.config.schedules.map((item) => item.id === schedule.id
            ? { ...item, nextRunAt: Date.now() + 60_000 }
            : item);
          continue;
        }
        try {
          await dispatch(state, schedule);
        } catch (error) {
          appendHistory(state, {
            completedAt: new Date().toISOString(),
            mode: schedule.mode,
            target: schedule.target,
            status: "failed",
            exitCode: -1,
            rawOutput: String(error?.message || error).slice(0, 1000),
            scheduleId: schedule.id,
            nodeUuid: schedule.clients[0],
            nodeName: schedule.clients[0],
            carrier: schedule.carrier,
            region: schedule.region,
          });
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

function load() {
  server.route("GET", `${API_BASE}/status`, async (req, res) => {
    if (!authorized(req, res)) return;
    await withStateLock(async () => {
      const state = readState();
      respond(res, 200, {
        config: state.config,
        pending: state.pending.length,
        history: state.history.slice(-100).reverse(),
        updatedAt: state.updatedAt,
        modes: MODES,
        intervals: [1, 5, 15, 60, 360, 720, 1440],
      });
    });
  });

  server.route("PUT", `${API_BASE}/config`, async (req, res) => {
    if (!authorized(req, res)) return;
    try {
      const incoming = normalizeConfig(readBody(req));
      await withStateLock(async () => {
        const current = readState();
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
      const scheduleId = decodeURIComponent(req.url.split("/").pop().split("?")[0]);
      await withStateLock(async () => {
        const state = readState();
        if (state.pending.length > 0) throw new Error("已有网络检测任务运行或等待节点回报");
        const schedule = state.config.schedules.find((item) => item.id === scheduleId && item.enabled);
        if (!schedule) throw new Error("未找到已启用的计划");
        await dispatch(state, schedule);
        state.updatedAt = new Date().toISOString();
        writeState(state);
        respond(res, 202, { task: state.pending[state.pending.length - 1] });
      });
    } catch (error) {
      respond(res, 400, { error: String(error?.message || error) });
    }
  });

  server.cron("* * * * *", () => { void tick(); });
  void tick();
}

module.exports = { load };
