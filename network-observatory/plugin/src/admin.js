const crypto = require("crypto");
const { API_BASE, MODES, UUID, normalizeSchedule, normalizeConfig, nextRunAt } = require("./model.js");
const { CATALOG, CATALOG_VERSION } = require("./catalog.js");
const { makePolicy, reconcilePolicies, planId } = require("./policies.js");

function query(req, key) {
  for (const part of String(req.url).split("?").slice(1).join("?").split("&")) {
    const [name, value = ""] = part.split("=");
    if (name === key) return decodeURIComponent(value);
  }
  return "";
}
const segments = (req) => String(req.url).split("?")[0].slice(API_BASE.length + 1).split("/").map(decodeURIComponent);
function conflict(message) { const error = new Error(message); error.status = 409; throw error; }

function registerAdminRoutes(ctx) {
  const { server, readState, writeState, withStateLock, authorized, readBody, respond, nodeHistory, safeNodeList, syncInventory, queueSchedule, requiredTool } = ctx;
  function route(method, suffix, handler) {
    server.route(method, `${API_BASE}${suffix}`, async (req, res) => {
      if (!authorized(req, res)) return;
      try { await handler(req, res); }
      catch (error) { respond(res, error.status || 400, { error: String(error.message || error) }); }
    });
  }
  function nodeId(req) { const id = segments(req)[1]; if (!UUID.test(id)) throw new Error("节点 UUID 无效"); return id; }
  function save(state) { state.updatedAt = new Date().toISOString(); writeState(state); }
  function checkInventory(state) { if (state.inventoryError || !state.inventoryAt) throw new Error(state.inventoryError || "请先同步 Komari 节点清单"); }
  function historyPage(state, uuid, req) {
    const mode = query(req, "mode");
    const all = nodeHistory(state, uuid).slice().reverse().filter((row) => !mode || row.mode === mode);
    const key = (row) => `${row.completedAt}|${row.taskId || row.scheduleId}`;
    const cursor = query(req, "before");
    const index = cursor ? all.findIndex((row) => key(row) === cursor) : -1;
    const rows = cursor ? index >= 0 ? all.slice(index + 1) : all.filter((row) => row.completedAt < cursor.split("|")[0]) : all;
    const items = rows.slice(0, 20);
    return { items, total: all.length, nextCursor: rows.length > 20 ? key(items[items.length - 1]) : "" };
  }

  route("GET", "/catalog", async (_req, res) => {
    // Inventory is refreshed by cron, and immediately when the management UI opens.
    await syncInventory();
    const state = readState();
    respond(res, 200, { apiVersion: 2, version: CATALOG_VERSION, presets: CATALOG, policies: state.policies, inventory: state.inventory, inventoryAt: state.inventoryAt, inventoryError: state.inventoryError, nodes: safeNodeList(state.nodes) });
  });
  route("GET", "/nodes/:uuid/status", async (req, res) => {
    const uuid = nodeId(req), state = readState();
    const schedules = state.config.schedules.filter((plan) => plan.clients[0] === uuid);
    const history = nodeHistory(state, uuid).slice().reverse();
    const seen = new Set();
    const latest = history.filter((row) => { const id = `${row.mode}:${row.target}:${row.scheduleId}`; if (seen.has(id)) return false; seen.add(id); return true; }).slice(0, 100);
    respond(res, 200, { apiVersion: 2, schedules, tasks: state.tasks.filter((task) => task.nodeUuid === uuid), node: safeNodeList(state.nodes).find((node) => node.uuid === uuid) || null, latest, history: historyPage(state, uuid, req), inventoryError: state.inventoryError, policies: state.policies.filter((p) => schedules.some((s) => s.sourcePolicy === p.id)) });
  });
  route("GET", "/nodes/:uuid/history", async (req, res) => { respond(res, 200, historyPage(readState(), nodeId(req), req)); });

  route("PUT", "/nodes/:uuid/plans/:id", async (req, res) => {
    const uuid = nodeId(req), id = segments(req)[3], input = readBody(req);
    await withStateLock(async () => {
      const state = readState(), old = state.config.schedules.find((plan) => plan.id === id);
      if (old && old.clients[0] !== uuid) throw new Error("计划不属于当前节点");
      if (old && input.revision !== old.revision) conflict("计划已在其他页面修改，请刷新后重试");
      if (["throughput", "tcpquality-all", "tcpquality-report", "tcpquality-intl-report"].includes(input.mode) && input.trafficAccepted !== true && (!old || old.mode !== input.mode || old.target !== input.target || old.port !== input.port)) throw new Error("请确认目标授权、报告上传和检测流量");
      if (!state.inventory.some((node) => node.uuid === uuid) && !state.nodes[uuid]) throw new Error("Komari 节点不存在或尚未同步");
      const normalized = normalizeSchedule({ ...input, id, clients: [uuid], revision: (old?.revision || 0) + 1, sourcePolicy: old?.sourcePolicy || "", customized: Boolean(old?.sourcePolicy), catalogVersion: old?.catalogVersion || "" });
      const sameTiming = old && old.intervalMinutes === normalized.intervalMinutes && old.scheduleType === normalized.scheduleType && old.utcOffsetMinutes === normalized.utcOffsetMinutes && JSON.stringify(old.dailyTimes) === JSON.stringify(normalized.dailyTimes);
      const plan = { ...normalized, nextRunAt: sameTiming ? old.nextRunAt : nextRunAt(normalized) };
      state.config = normalizeConfig({ schedules: [...state.config.schedules.filter((p) => p.id !== id), plan] });
      state.tasks = state.tasks.filter((t) => t.status === "running" || t.scheduleId !== id);
      save(state);
      respond(res, 200, { plan });
    });
  });
  route("DELETE", "/nodes/:uuid/plans/:id", async (req, res) => {
    const uuid = nodeId(req), id = segments(req)[3];
    await withStateLock(async () => {
      const state = readState(), plan = state.config.schedules.find((p) => p.id === id && p.clients[0] === uuid);
      if (!plan) throw new Error("计划不存在");
      if (Number(query(req, "revision")) !== plan.revision) conflict("计划已修改，请刷新后重试");
      if (plan.sourcePolicy) for (const policy of state.policies) policy.exclusions = [...new Set([...(policy.exclusions || []), id])];
      state.config.schedules = state.config.schedules.filter((p) => p.id !== id);
      state.tasks = state.tasks.filter((task) => task.scheduleId !== id || task.status === "running");
      save(state); respond(res, 200, { ok: true });
    });
  });
  route("POST", "/nodes/:uuid/test", async (req, res) => {
    const uuid = nodeId(req), input = readBody(req);
    await withStateLock(async () => {
      const state = readState();
      if (!MODES.includes(input.mode)) throw new Error("检测类型无效");
      if (["throughput", "tcpquality-all", "tcpquality-report", "tcpquality-intl-report"].includes(input.mode) && input.trafficAccepted !== true) throw new Error("请确认目标授权、报告上传和检测流量");
      const plan = normalizeSchedule({ ...input, id: crypto.randomUUID().replace(/-/g, ""), clients: [uuid], enabled: true });
      if (state.tasks.some((task) => task.nodeUuid === uuid)) throw new Error("当前节点仍有任务，请等待完成");
      queueSchedule(state, plan); save(state);
      respond(res, 202, { task: state.tasks[state.tasks.length - 1] });
    });
  });

  function expand(state, input) {
    checkInventory(state);
    const ids = [...new Set(input.presetIds || [])];
    if (!ids.length || ids.length > CATALOG.length) throw new Error("请选择内置检测方案");
    const draft = JSON.parse(JSON.stringify(state));
    const policies = [];
    for (const presetId of ids) {
      let policy = makePolicy({ ...input, presetId, settings: input.settingsByPreset?.[presetId] || input.settings });
      const old = draft.policies.find((p) => p.id === policy.id);
      if (old) {
        if (JSON.stringify(old.settings) !== JSON.stringify(policy.settings)) conflict("该范围已有同名方案，请在方案管理中编辑频率或目标");
        policy = old;
      } else { draft.policies.push(policy); }
      policies.push(policy);
    }
    if (draft.policies.length > 200) throw new Error("方案数量超过 200，请编辑或删除已有方案");
    reconcilePolicies(draft, draft.inventory);
    const selectedIds = new Set();
    for (const policy of policies) for (const node of draft.inventory) {
      if (policy.clients.includes(node.uuid) || policy.groups.includes(node.group)) {
        for (const item of policy.items) selectedIds.add(planId(policy, node.uuid, item));
      }
    }
    const plans = draft.config.schedules.filter((plan) => selectedIds.has(plan.id));
    const newPlans = plans.filter((p) => !state.config.schedules.some((old) => old.id === p.id));
    const matches = draft.inventory.filter((node) => plans.some((p) => p.clients[0] === node.uuid));
    const preview = matches.map((item) => {
      const node = draft.nodes[item.uuid];
      const needed = [...new Set(plans.filter((p) => p.clients[0] === item.uuid).map((p) => requiredTool(p.mode)))];
      const missing = node?.capabilities ? [...needed, "timeout"].filter((tool) => !node.capabilities.includes(tool)) : [];
      return { ...item, state: !node ? "未接入" : missing.length ? `缺少 ${missing.join("、")}` : !node.capabilities ? "工具待检测：升级探测器" : Date.now() - Date.parse(node.lastSeenAt) < 90_000 ? "就绪" : "探测器离线", planCount: plans.filter((p) => p.clients[0] === item.uuid).length };
    });
    if (!matches.length && !(input.groups || []).length) throw new Error("所选节点已不存在，请刷新清单");
    return { draft, plans, newPlans, preview, policies };
  }
  route("POST", "/policies/preview", async (req, res) => {
    const { plans, newPlans, preview } = expand(readState(), readBody(req));
    respond(res, 200, { planCount: plans.length, added: newPlans.length, unchanged: plans.length - newPlans.length, nodes: preview });
  });
  route("POST", "/policies/apply", async (req, res) => {
    const input = readBody(req);
    await withStateLock(async () => {
      const state = readState();
      const { draft, newPlans, preview, policies } = expand(state, input);
      if (input.inherit === false) {
        draft.policies = state.policies;
        draft.config.schedules = draft.config.schedules.map((p) => newPlans.some((n) => n.id === p.id) ? { ...p, sourcePolicy: "", customized: false } : p);
      }
      save(draft); respond(res, 200, { added: newPlans.length, nodes: preview, policyIds: policies.map((p) => p.id) });
    });
  });
  route("PUT", "/policies/:id", async (req, res) => {
    const id = segments(req)[1], input = readBody(req);
    await withStateLock(async () => {
      const state = readState(), old = state.policies.find((p) => p.id === id);
      if (!old) throw new Error("方案不存在");
      if (input.revision !== old.revision) conflict("方案已在其他页面修改，请刷新后重试");
      const policy = makePolicy({ ...old, ...input, id }, old);
      state.policies = state.policies.map((p) => p.id === id ? policy : p);
      reconcilePolicies(state, state.inventory); save(state); respond(res, 200, { policy });
    });
  });
  route("DELETE", "/policies/:id", async (req, res) => {
    const id = segments(req)[1];
    await withStateLock(async () => {
      const state = readState(), policy = state.policies.find((p) => p.id === id);
      if (!policy) throw new Error("方案不存在");
      if (Number(query(req, "revision")) !== policy.revision) conflict("方案已修改，请刷新后重试");
      state.policies = state.policies.filter((p) => p.id !== id);
      reconcilePolicies(state, state.inventory);
      state.config.schedules = state.config.schedules.map((p) => p.sourcePolicy === id ? { ...p, sourcePolicy: "", customized: false } : p);
      save(state); respond(res, 200, { ok: true });
    });
  });
}

module.exports = { registerAdminRoutes };
