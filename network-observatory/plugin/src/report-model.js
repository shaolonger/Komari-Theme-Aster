const crypto = require("crypto");
const M = require("./native-model.js");
const { UUID } = require("./model.js");
const { MODULES } = require("./round-store.js");
const { VERSION, ENDPOINTS, PRESETS } = require("./report-catalog.js");
const CITIES = ["北京", "上海", "广州"];
const INTERNATIONAL_CITIES = [
  "香港",
  "东京",
  "新加坡",
  "悉尼",
  "洛杉矶",
  "旧金山",
  "纽约",
  "法兰克福",
  "伦敦",
  "阿姆斯特丹",
];
const kindFor = (op) =>
  ["benchmark", "http-speed", "iperf-speed"].includes(op)
    ? "speed"
    : op === "globalping"
      ? "route"
      : op;
function normalizeSuite(input, resources = []) {
  if (
    !input ||
    !Array.isArray(input.modules) ||
    !input.modules.length ||
    input.modules.length > MODULES.length
  )
    throw new Error("请选择 1–6 个报告模块");
  const range = M.normalizePolicy({
    kind: "websites",
    clients: input.clients,
    groups: input.groups,
    inherit: input.inherit,
    sites: ["www.cloudflare.com"],
  });
  const directory = [...ENDPOINTS, ...resources];
  const seen = new Set();
  const modules = input.modules.map((value) => {
    if (!MODULES.includes(value.module) || seen.has(value.module))
      throw new Error("模块无效或重复");
    seen.add(value.module);
    const preset =
      PRESETS.find((p) => p.id === value.preset && p.module === value.module) ||
      PRESETS.find((p) => p.module === value.module);
    const endpoints = [
      ...new Set(
        value.endpoints === undefined ? preset.endpoints : value.endpoints,
      ),
    ];
    if (
      endpoints.length > 250 ||
      endpoints.some(
        (id) => typeof id !== "string" || !directory.some((e) => e.id === id),
      )
    )
      throw new Error("报告目标不在当前目录中或超过 250 个");
    const speed = value.module.endsWith("speed");
    if (speed && input.trafficAccepted !== true)
      throw new Error("启用全速测速前需要接受时长和流量说明");
    const family = value.family || "4";
    if (!["4", "6"].includes(family)) throw new Error("请选择 IPv4 或 IPv6");
    const protocols = [...new Set(value.protocols || ["tcp"])];
    if (
      !protocols.length ||
      protocols.some((p) => !["tcp", "icmp"].includes(p))
    )
      throw new Error("路由协议无效");
    const sources = [...new Set(value.sources || [])];
    if (sources.length > 24 || sources.some((id) => !UUID.test(id)))
      throw new Error("测量点选择无效");
    const seconds = value.seconds === undefined ? 10 : value.seconds,
      warmupSeconds =
        value.warmupSeconds === undefined ? 2 : value.warmupSeconds;
    if (
      !Number.isInteger(seconds) ||
      seconds < 5 ||
      seconds > 20 ||
      ![0, 2].includes(warmupSeconds)
    )
      throw new Error("测速有效时长须为 5–20 秒，预热为 0 或 2 秒");
    const streams = [...new Set(value.streams || [1])];
    if (
      !streams.includes(1) ||
      streams.length > 2 ||
      streams.some((p) => ![1, 4, 8].includes(p))
    )
      throw new Error("请选择单连接或另一个独立的多连接测试");
    if (
      speed &&
      streams.length > 1 &&
      endpoints.some(
        (id) => directory.find((e) => e.id === id)?.method === "http",
      )
    )
      throw new Error("HTTP 端点只支持 P1；请对 iperf3 单独设置多连接方案");
    const timing = M.timing(
      value.timing || preset.timing,
      speed ? "speed" : value.module === "routes" ? "routes" : "websites",
    );
    if (
      value.module === "bgp" &&
      timing.type === "interval" &&
      timing.minutes < 60
    )
      throw new Error("公开 BGP 快照间隔至少一小时；同前缀复用 55 分钟缓存");
    return {
      module: value.module,
      preset: preset.id,
      endpoints,
      family,
      protocols,
      sources,
      publicSources: value.publicSources !== false && value.module === "routes",
      seconds,
      warmupSeconds,
      streams,
      timing,
      enabled: value.enabled !== false,
      nextAt: M.next(timing),
    };
  });
  return {
    id: UUID.test(input.id || "") ? input.id : crypto.randomUUID(),
    name: M.text(input.name, 80) || "网络报告",
    clients: range.clients,
    groups: range.groups,
    inherit: input.inherit !== false,
    enabled: input.enabled !== false,
    trafficAccepted: input.trafficAccepted === true,
    modules,
    catalogVersion: VERSION,
  };
}
function directory(s) {
  return [...ENDPOINTS, ...(s.reportResources || [])];
}
function addressForFamily(value, family) {
  if (
    !value ||
    (value.includes(":") && family !== "6") ||
    (/^[0-9.]+$/.test(value) && family !== "4")
  )
    return "";
  return value;
}
function planSlots(s, suite, module, nodeUuid, roundId) {
  const slots = [],
    jobs = [],
    endpoint = s.endpoints[nodeUuid],
    all = directory(s);
  const nodeTarget = addressForFamily(
    (module.family === "6" ? endpoint?.ipv6 : endpoint?.ipv4) ||
      endpoint?.address,
    module.family,
  );
  function add(
    slotId,
    target,
    source,
    direction,
    operation,
    executor,
    options,
    resource,
    missing,
  ) {
    const id = crypto.randomUUID();
    const slot = {
      id: slotId,
      jobId: id,
      target,
      direction,
      source,
      endpoint: resource || null,
      options,
      missingReason: missing || "",
    };
    slots.push(slot);
    jobs.push({
      id,
      roundId,
      slotId,
      nodeUuid,
      policyId: suite.id,
      reportModule: module.module,
      operation,
      executor,
      target,
      source,
      direction,
      options,
      pairId: source.id
        ? `${roundId}:${source.id}:${module.family}:${options.protocol || "tcp"}`
        : "",
      missingReason: missing || "",
      phase: "queued",
      queuedAt: Date.now(),
      expiresAt: Date.now() + 6 * 3600000,
    });
  }
  const common = { family: module.family, reportVersion: 3 };
  const source = { provider: "runner", name: "当前 VPS" };
  if (["international", "idc"].includes(module.module)) {
    for (const id of module.endpoints) {
      const e = all.find((r) => r.id === id);
      const mismatch = e.family !== "auto" && e.family !== module.family;
      add(
        id,
        e.address,
        source,
        "VPS→目标",
        "latency",
        "node:" + nodeUuid,
        {
          ...common,
          port: e.port,
          path: e.path || "/",
          https: e.https === true,
        },
        e,
        !e.uses.includes("latency")
          ? "端点未允许延迟测试"
          : mismatch
            ? "端点不支持所选地址族"
            : "",
      );
    }
  }
  if (module.module === "routes") {
    for (const protocol of module.protocols) {
      for (const id of module.endpoints) {
        const e = all.find((r) => r.id === id);
        add(
          `${id}:${protocol}:return`,
          e.address,
          { provider: e.provider, city: e.city, carrier: e.carrier },
          "VPS→大陆",
          "route",
          "node:" + nodeUuid,
          {
            ...common,
            protocol,
            port: e.port || 443,
            fullMtr: true,
            packets: 20,
          },
          e,
          e.uses.includes("route") &&
            (e.family === "auto" || e.family === module.family)
            ? ""
            : "目标不支持当前路由用途/地址族",
        );
      }
      for (const id of module.sources) {
        const probe = s.probes[id];
        const origin = probe
          ? {
              provider: "controlled",
              id,
              name: probe.name,
              city: probe.city,
              carrier: probe.carrier,
              accessType: probe.accessType,
            }
          : { provider: "controlled", id };
        add(
          `probe:${id}:${protocol}:forward`,
          nodeTarget,
          origin,
          "大陆→VPS",
          "route",
          "probe:" + id,
          { ...common, protocol, fullMtr: true, packets: 20, port: 443 },
          null,
          !probe
            ? "已登记的测量点不存在"
            : !nodeTarget
              ? "缺少符合地址族的 VPS 公网地址"
              : "",
        );
        const probeTarget = addressForFamily(
          probe?.publicAddress,
          module.family,
        );
        add(
          `probe:${id}:${protocol}:return`,
          probeTarget,
          origin,
          "VPS→大陆",
          "route",
          "node:" + nodeUuid,
          { ...common, protocol, fullMtr: true, packets: 20, port: 443 },
          null,
          !probeTarget
            ? "测量点没有符合地址族的可达公网目标；NAT 设备仍可进行双向测速"
            : "",
        );
      }
      if (module.publicSources)
        for (const carrier of M.CARRIERS)
          add(
            `public:${carrier.asn}:${protocol}`,
            nodeTarget,
            {
              provider: "Globalping",
              country: "CN",
              carrier: carrier.name,
              asn: carrier.asn,
            },
            "大陆→VPS",
            "globalping",
            "globalping",
            { ...common, protocol, fullMtr: true, packets: 16, port: 443 },
            null,
            !nodeTarget ? "缺少符合地址族的 VPS 公网地址" : "",
          );
    }
  }
  if (module.module.endsWith("speed")) {
    const selected = module.endpoints.map((id) => all.find((e) => e.id === id));
    const pairs =
      module.module === "china-speed"
        ? CITIES.flatMap((city) =>
            M.CARRIERS.map((c) => ({ city, carrier: c.name })),
          )
        : INTERNATIONAL_CITIES.map((city) => ({ city, carrier: "" }));
    const used = new Set();
    for (const pair of pairs) {
      const e = selected.find(
        (r) =>
          r.city === pair.city && (!pair.carrier || r.carrier === pair.carrier),
      );
      const probeId = module.sources.find(
        (id) =>
          s.probes[id]?.city === pair.city &&
          (!pair.carrier || s.probes[id]?.carrier === pair.carrier),
      );
      const probe = s.probes[probeId];
      const label = `${pair.city}:${pair.carrier || "international"}`;
      const options = {
        ...common,
        seconds: module.seconds,
        warmupSeconds: module.warmupSeconds,
        streams: module.streams,
        port: e?.port || endpoint?.port || 25201,
      };
      if (e) {
        used.add(e.id);
        add(
          label,
          e.address,
          { provider: e.provider, city: pair.city, carrier: pair.carrier },
          "VPS↔端点",
          e.method === "iperf3" ? "iperf-speed" : "http-speed",
          "node:" + nodeUuid,
          { ...options, endpoint: e },
          e,
          e.uses.includes("speed") &&
            e.authorized &&
            (e.family === "auto" || e.family === module.family)
            ? ""
            : "目标未获准吞吐测速或不支持所选地址族",
        );
      } else if (probe)
        add(
          label,
          nodeTarget,
          {
            provider: "controlled",
            id: probeId,
            name: probe.name,
            ...pair,
            accessType: probe.accessType,
          },
          "大陆↔VPS",
          "benchmark",
          "probe:" + probeId,
          options,
          null,
          !nodeTarget ? "缺少符合地址族的 VPS 公网地址" : "",
        );
      else
        add(
          label,
          "",
          { provider: "coverage", ...pair },
          module.module === "china-speed" ? "大陆↔VPS" : "VPS↔端点",
          "benchmark",
          "node:" + nodeUuid,
          options,
          null,
          "未配置此地区的授权测速端点或测量点",
        );
    }
    for (const e of selected.filter((r) => !used.has(r.id)))
      add(
        e.id,
        e.address,
        { provider: e.provider, city: e.city, carrier: e.carrier },
        "VPS↔端点",
        e.method === "iperf3" ? "iperf-speed" : "http-speed",
        "node:" + nodeUuid,
        {
          ...common,
          seconds: module.seconds,
          warmupSeconds: module.warmupSeconds,
          streams: module.streams,
          port: e.port,
          endpoint: e,
        },
        e,
        e.uses.includes("speed") &&
          e.authorized &&
          (e.family === "auto" || e.family === module.family)
          ? ""
          : "目标未获准吞吐测速或不支持所选地址族",
      );
  }
  if (module.module === "bgp")
    add(
      "bgp:" + module.family,
      nodeTarget,
      { provider: "RIPE RIS / RouteViews" },
      "BGP 控制平面",
      "bgp",
      "bgp",
      common,
      null,
      !nodeTarget ? "缺少符合地址族的 VPS 公网地址" : "",
    );
  if (!slots.length)
    add(
      "coverage",
      "",
      { provider: "coverage" },
      "未测量",
      module.module === "routes" ? "route" : "latency",
      "node:" + nodeUuid,
      common,
      null,
      "尚未选择此模块的测量端点",
    );
  if (slots.length > 250)
    throw new Error("此模块超过每轮 250 个目标的容量；请减少目标/协议/测量点");
  return { slots, jobs };
}
module.exports = {
  normalizeSuite,
  planSlots,
  directory,
  kindFor,
  CITIES,
  INTERNATIONAL_CITIES,
};
