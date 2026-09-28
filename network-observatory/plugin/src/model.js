const API_BASE = "/api/aster-network-observatory/v1";
const HISTORY_LIMIT = 500;
const PLAN_LIMIT = 5000;
const TASK_OUTPUT_LIMIT = 48_000;
const MODES = Object.freeze([
  "https",
  "route",
  "throughput",
  "tcpquality-route",
  "tcpquality-intl",
  "tcpquality-all",
]);
const INTERVALS = Object.freeze([1, 5, 15, 60, 360, 720, 1440]);
const TCPQUALITY_INTERVALS = Object.freeze([1440]);
const MODE_INTERVALS = Object.freeze({
  https: INTERVALS,
  route: [360, 720, 1440],
  throughput: [1440],
  "tcpquality-route": TCPQUALITY_INTERVALS,
  "tcpquality-intl": TCPQUALITY_INTERVALS,
  "tcpquality-all": TCPQUALITY_INTERVALS,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function isHost(value) {
  if (typeof value !== "string") return false;
  const host = value.trim();
  if (!host || host.length > 253 || /[\s/\\@?#]/.test(host)) return false;
  if (/^[0-9.]+$/.test(host)) {
    const octets = host.split(".");
    return octets.length === 4 && octets.every((octet) => /^(0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255);
  }
  if (host.includes(":")) {
    if (!/^[0-9a-f:]+$/i.test(host) || host.includes(":::")) return false;
    if ((host.match(/::/g) || []).length > 1) return false;
    const compressed = host.includes("::");
    const parts = host.split(":").filter(Boolean);
    return parts.every((part) => /^[0-9a-f]{1,4}$/i.test(part)) &&
      (compressed ? parts.length < 8 : parts.length === 8);
  }
  return HOST.test(host);
}

function clampText(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, maxLength) : "";
}

function normalizeSchedule(input, index = 0) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("计划格式无效");
  const id = clampText(input.id, 48);
  const mode = input.mode;
  const intervalMinutes = Number(input.intervalMinutes);
  const enabled = input.enabled === true;
  const name = clampText(input.name, 64);
  const isTcpQuality = mode?.startsWith("tcpquality-");
  const target = isTcpQuality ? "default" : clampText(input.target, 253).toLowerCase();
  const carrier = clampText(input.carrier, 48);
  const region = clampText(input.region, 64);
  const port = Number(input.port ?? (mode === "https" ? 443 : 5201));
  const clients = Array.isArray(input.clients)
    ? [...new Set(input.clients.filter((uuid) => typeof uuid === "string" && UUID.test(uuid)))].slice(0, 100)
    : [];

  if (!/^[a-z0-9][a-z0-9_-]{2,47}$/i.test(id)) throw new Error(`第 ${index + 1} 条计划 ID 无效`);
  if (!MODES.includes(mode)) throw new Error(`${name || id}：检测类型无效`);
  if (!MODE_INTERVALS[mode].includes(intervalMinutes)) {
    throw new Error(`${name || id}：检测间隔无效`);
  }
  if (!name || (!isTcpQuality && !isHost(target))) throw new Error(`${name || id}：请填写有效的目标主机名或 IP 地址`);
  if (["https", "throughput"].includes(mode) && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error(`${name}：端口必须介于 1 和 65535`);
  }
  if (clients.length !== 1) throw new Error(`${name}：每个计划必须且只能选择一台 VPS`);

  return {
    id,
    mode,
    enabled,
    name,
    target,
    carrier,
    region,
    port: ["https", "throughput"].includes(mode) ? port : 0,
    intervalMinutes,
    clients,
    nextRunAt: Number.isFinite(Number(input.nextRunAt)) ? Number(input.nextRunAt) : 0,
    revision: Number.isSafeInteger(input.revision) ? input.revision : 0,
    sourcePolicy: clampText(input.sourcePolicy, 48),
    customized: input.customized === true,
    catalogVersion: clampText(input.catalogVersion, 40),
  };
}

function normalizeConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { schedules: [] };
  const items = Array.isArray(input.schedules) ? input.schedules : [];
  if (items.length > PLAN_LIMIT) throw new Error(`计划数量超过 ${PLAN_LIMIT}，请缩小应用范围`);
  const schedules = items.map(normalizeSchedule);
  const ids = new Set();
  for (const schedule of schedules) {
    if (ids.has(schedule.id)) throw new Error(`计划 ID 重复：${schedule.id}`);
    ids.add(schedule.id);
  }
  return { schedules };
}

function parseProbeOutput(output, expected = {}) {
  if (typeof output !== "string") throw new Error("Agent 未返回文本结果");
  const lines = output.replace(/\r\n/g, "\n").split("\n");
  const marker = lines.find((line) => line.startsWith("ASTER_NETWORK_RESULT_V1\t"));
  if (!marker) throw new Error(`探测程序没有返回结果标记：${output.slice(0, TASK_OUTPUT_LIMIT) || "（空输出）"}`);
  const [, mode, target, exitText, encoded] = marker.split("\t");
  if (!MODES.includes(mode) || !isHost(target)) throw new Error("探测结果标记无效");
  const exitCode = Number(exitText);
  if (!Number.isInteger(exitCode)) throw new Error("探测退出码无效");
  let rawOutput = "";
  try {
    rawOutput = Buffer.from(encoded ?? "", "base64").toString("utf8").slice(0, TASK_OUTPUT_LIMIT);
  } catch {
    throw new Error("探测原始输出编码无效");
  }
  return {
    mode,
    target,
    exitCode,
    status: exitCode === 0 ? "success" : exitCode === 124 ? "timeout" : "failed",
    rawOutput,
    completedAt: new Date().toISOString(),
    scheduleId: expected.scheduleId ?? "",
    nodeUuid: expected.nodeUuid ?? "",
    nodeName: clampText(expected.nodeName, 100),
    carrier: clampText(expected.carrier, 48),
    region: clampText(expected.region, 64),
  };
}

function readAdminPrincipal(principal) {
  if (!principal || !["user", "api_key"].includes(principal.type)) return false;
  const roles = Array.isArray(principal.roles) ? principal.roles.map((role) => String(role).toLowerCase()) : [];
  return roles.some((role) => role === "admin" || role === "administrator");
}

function createDueRuns(config, now = Date.now()) {
  const schedule = config.schedules.find((item) => item.enabled && item.nextRunAt <= now);
  if (!schedule) return { due: [], config };
  const schedules = config.schedules.map((item) => item.id === schedule.id
    ? { ...item, nextRunAt: now + item.intervalMinutes * 60_000 }
    : item);
  return { due: [schedule], config: { schedules } };
}

module.exports = {
  API_BASE,
  HISTORY_LIMIT,
  PLAN_LIMIT,
  UUID,
  MODE_INTERVALS,
  normalizeSchedule,
  INTERVALS,
  MODES,
  TASK_OUTPUT_LIMIT,
  createDueRuns,
  isHost,
  normalizeConfig,
  normalizeSchedule,
  parseProbeOutput,
  readAdminPrincipal,
};
