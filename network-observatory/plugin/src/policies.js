const crypto = require("crypto");
const { CATALOG, CATALOG_VERSION } = require("./catalog.js");
const { normalizeSchedule, normalizeConfig, UUID } = require("./model.js");
const stableId = (value) => crypto.createHash("sha256").update(value).digest("hex").slice(0, 28);
const clean = (value, length = 100) => typeof value === "string" ? value.trim().slice(0, length) : "";

function normalizeInventory(value) {
  if (!Array.isArray(value)) throw new Error("Komari 节点清单格式无效");
  if (value.length > 2000) throw new Error("节点清单超过 2000 台，请缩小部署范围");
  return value.filter((node) => node && UUID.test(node.uuid)).map((node) => ({ uuid: node.uuid, name: clean(node.name), group: clean(node.group) }));
}

function makePolicy(input, previous) {
  const preset = CATALOG.find((item) => item.id === input.presetId);
  if (!preset) throw new Error("未找到内置方案，请更新主题和插件");
  const clients = [...new Set((Array.isArray(input.clients) ? input.clients : []).filter((uuid) => UUID.test(uuid)))].sort();
  const groups = [...new Set((Array.isArray(input.groups) ? input.groups : []).map((s) => clean(s)).filter(Boolean))].sort();
  if (!clients.length && !groups.length) throw new Error("请选择 VPS 或继承分组");
  const settings = { target: clean(input.settings?.target, 253).toLowerCase(), port: Number(input.settings?.port || preset.items[0].port || 0), intervalMinutes: Number(input.settings?.intervalMinutes || preset.items[0].intervalMinutes) };
  const id = clean(input.id, 48) || stableId(JSON.stringify([preset.id, clients, groups, preset.customTarget ? settings.target : ""]));
  if (!/^[a-z0-9_-]{3,48}$/i.test(id)) throw new Error("方案 ID 无效");
  if (preset.traffic && input.trafficAccepted !== true && !previous?.trafficAccepted) throw new Error("请确认测速端点授权和流量预算");
  // Validate once with a real-shaped UUID; bindings are expanded only by the server.
  preset.items.forEach((item) => normalizeSchedule({ ...item, ...settings, target: preset.customTarget ? settings.target : item.target, id: item.id, enabled: true, clients: ["00000000-0000-4000-8000-000000000001"] }));
  return { id, name: clean(input.name, 64) || preset.name, presetId: preset.id, catalogVersion: CATALOG_VERSION, items: preset.items.map((item) => ({ ...item })), settings, clients, groups, enabled: input.enabled !== false, trafficAccepted: preset.traffic ? true : false, exclusions: previous?.exclusions || [], revision: (previous?.revision || 0) + 1 };
}

function planId(policy, nodeUuid, item) {
  const preset = CATALOG.find((p) => p.id === policy.presetId);
  return stableId(`${policy.presetId}:${nodeUuid}:${item.id}:${preset?.customTarget ? policy.settings.target : item.target}`);
}

function reconcilePolicies(state, inventory, now = Date.now()) {
  const previousIds = new Set(state.config.schedules.map((p) => p.id));
  const expected = new Map();
  for (const policy of [...(state.policies || [])].sort((a, b) => Number(b.enabled) - Number(a.enabled))) {
    const preset = CATALOG.find((p) => p.id === policy.presetId);
    if (!preset) continue;
    for (const node of inventory) {
      if (!policy.clients.includes(node.uuid) && !policy.groups.includes(node.group)) continue;
      for (const item of policy.items) {
        const id = planId(policy, node.uuid, item);
        if (expected.has(id)) continue;
        if ((policy.exclusions || []).includes(id)) continue;
        const offset = parseInt(stableId(id).slice(0, 6), 16) % 300_000;
        expected.set(id, normalizeSchedule({
          ...item, ...policy.settings,
          target: preset.customTarget ? policy.settings.target : item.target,
          id, name: `${node.name || node.uuid} · ${item.name}`.slice(0, 64),
          enabled: policy.enabled, clients: [node.uuid], sourcePolicy: policy.id,
          catalogVersion: policy.catalogVersion, nextRunAt: now + 60_000 + offset,
        }));
      }
    }
  }
  const schedules = [];
  for (const old of state.config.schedules) {
    const desired = expected.get(old.id);
    expected.delete(old.id);
    if (!old.sourcePolicy || old.customized) { schedules.push(old); continue; }
    if (!desired) continue;
    const fields = ["name", "target", "port", "mode", "enabled", "intervalMinutes", "catalogVersion", "sourcePolicy"];
    const changed = fields.some((key) => old[key] !== desired[key]);
    schedules.push({ ...desired, revision: old.revision + (changed ? 1 : 0), nextRunAt: changed ? desired.nextRunAt : old.nextRunAt });
  }
  schedules.push(...expected.values());
  state.config = normalizeConfig({ schedules });
  const enabled = new Set(state.config.schedules.filter((p) => p.enabled).map((p) => p.id));
  state.tasks = (state.tasks || []).filter((t) => t.status === "running" || !previousIds.has(t.scheduleId) || enabled.has(t.scheduleId));
  return state;
}

module.exports = { makePolicy, reconcilePolicies, normalizeInventory, stableId, planId };
