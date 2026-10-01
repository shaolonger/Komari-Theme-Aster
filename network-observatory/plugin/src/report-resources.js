const crypto = require("crypto");
const M = require("./native-model.js");
const { ENDPOINTS, VERSION } = require("./report-catalog.js");
function normalizeResource(input) {
  const method = input.method || "tcp-connect";
  if (!["tcp-connect", "http", "iperf3"].includes(method))
    throw new Error("资源测量协议无效");
  if (input.uses !== undefined && !Array.isArray(input.uses))
    throw new Error("资源用途需为列表");
  const uses = [...new Set(input.uses || ["latency"])];
  if (
    !uses.length ||
    uses.some((v) => !["latency", "route", "speed"].includes(v))
  )
    throw new Error("资源用途无效");
  if (
    uses.includes("speed") &&
    (!input.authorized || !["http", "iperf3"].includes(method))
  )
    throw new Error("测速资源需要明确的授权与吞吐协议");
  if (!["4", "6", "auto"].includes(input.family))
    throw new Error("资源地址族无效");
  const port = Number(input.port || (method === "iperf3" ? 5201 : 443));
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("资源端口无效");
  const sourceUrl = M.text(input.sourceUrl, 500);
  if (!/^https:\/\/[^\s]+$/.test(sourceUrl))
    throw new Error("请提供 HTTPS 官方来源或授权说明链接");
  const path = (value) => {
    if (!value) return "";
    if (
      typeof value !== "string" ||
      !value.startsWith("/") ||
      /[\r\n]/.test(value) ||
      value.length > 500
    )
      throw new Error("HTTP 路径无效");
    return value;
  };
  const id =
    typeof input.id === "string" && /^custom:[0-9a-f-]{36}$/.test(input.id)
      ? input.id
      : "custom:" + crypto.randomUUID();
  if (ENDPOINTS.some((e) => e.id === id)) throw new Error("内置目录不能覆盖");
  const name = M.text(input.name, 80),
    city = M.text(input.city, 40),
    conditions = M.text(input.conditions, 400);
  if (!name || !city || !conditions)
    throw new Error("请填写名称、地区与授权/使用条件");
  return {
    id,
    name,
    address: M.host(input.address),
    port,
    method,
    family: input.family,
    uses,
    city,
    carrier: M.text(input.carrier, 30),
    country: M.text(input.country, 8),
    provider: M.text(input.provider, 60) || "自定义",
    category: uses.includes("speed")
      ? "speed"
      : input.category === "idc"
        ? "idc"
        : "websites",
    sourceUrl,
    conditions,
    restrictions: M.text(input.restrictions, 400),
    catalogVersion: VERSION,
    checkedAt: new Date().toISOString().slice(0, 10),
    health: "not-checked",
    https: input.https !== false,
    path: path(input.path) || "/",
    uploadPath: path(input.uploadPath),
    authorized: input.authorized === true,
  };
}
function migration(policy, revision, resources) {
  const R = require("./report-model.js");
  const module = {
    module: {
      websites: "international",
      routes: "routes",
      speed: "china-speed",
    }[policy.kind],
    family: policy.family,
    protocols: [policy.protocol],
    sources: policy.sources,
    publicSources: policy.publicSources,
    seconds: policy.seconds,
    warmupSeconds: 0,
    streams: policy.kind === "speed" ? [1] : policy.streams,
    timing: policy.timing,
  };
  const additional = [];
  if (policy.kind === "websites")
    module.endpoints = policy.sites.map((address) => {
      const known = [...ENDPOINTS, ...resources].find(
        (e) => e.address === address && e.uses.includes("latency"),
      );
      if (known) return known.id;
      const e = normalizeResource({
        name: address,
        address,
        port: 443,
        uses: ["latency"],
        method: "tcp-connect",
        family: "auto",
        city: "服务接入点",
        sourceUrl: "https://" + address,
        conditions: "由旧计划迁移的用户目标；不判断解锁",
      });
      additional.push(e);
      return e.id;
    });
  const suite = R.normalizeSuite(
    {
      name: policy.name,
      clients: policy.clients,
      groups: policy.groups,
      inherit: policy.inherit,
      enabled: policy.enabled,
      trafficAccepted: policy.trafficAccepted,
      modules: [module],
    },
    [...resources, ...additional],
  );
  return {
    suite: { ...suite, revision },
    additional,
    legacyId: policy.id,
    differences:
      policy.kind === "speed"
        ? [
            "迁移为单连接 P1；旧多连接速率不会混入新版单连接报告",
            "九格缺少资源的位置记录缺测",
          ]
        : policy.kind === "routes"
          ? ["回程改为完整 MTR；旧单次 traceroute 保留在旧报告区"]
          : ["每目标十次 TCP 建连，HTTPS 应用响应独立记录"],
    disableOldTrigger: true,
  };
}
module.exports = { normalizeResource, migration };
