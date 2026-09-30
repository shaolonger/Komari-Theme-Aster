const crypto = require("crypto");
const { UUID, isHost } = require("./model.js");
const tz = require("./timezones.json");
const { CATALOG } = require("./catalog.js");
const WEBSITES = [
  "www.google.com",
  "www.youtube.com",
  "github.com",
  "www.cloudflare.com",
  "www.wikipedia.org",
  "www.microsoft.com",
  "www.apple.com",
  "www.amazon.com",
  "www.netflix.com",
  "www.reddit.com",
  "www.openai.com",
  "www.bing.com",
];
const CARRIERS = [
  { name: "电信", asn: 4134 },
  { name: "联通", asn: 4837 },
  { name: "移动", asn: 9808 },
];
const TIMEZONES = Object.keys(tz.zones);
function offset(zone, now) {
  const rows = tz.zones[zone];
  if (!rows || now < tz.from || now >= tz.until)
    throw new Error("时区或日期超出支持范围（2020–2040）");
  let value = rows[0][1];
  for (const row of rows) {
    if (row[0] > now) break;
    value = row[1];
  }
  return value;
}
function timing(input, kind) {
  if (input?.type === "daily") {
    const times = [...new Set(input.times || [])].sort();
    if (
      !times.length ||
      times.length > 8 ||
      times.some(
        (t) => typeof t !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t),
      )
    )
      throw new Error("每日时刻需为 1–8 个 HH:mm");
    if (!TIMEZONES.includes(input.timezone))
      throw new Error("请选择支持的 IANA 时区");
    return { type: "daily", times, timezone: input.timezone };
  }
  const minutes = Number(
    input?.minutes || (kind === "speed" ? 1440 : kind === "routes" ? 60 : 15),
  );
  if (
    ![5, 15, 30, 60, 360, 720, 1440].includes(minutes) ||
    (kind === "speed" && minutes < 1440)
  )
    throw new Error("检测间隔无效；全速测速至少每天一次");
  return { type: "interval", minutes };
}
function next(t, now = Date.now()) {
  if (t.type === "interval") return now + t.minutes * 60000;
  // Minute scan covers DST gaps/repeated hours without requiring Intl in Goja.
  for (
    let at = Math.floor(now / 60000) * 60000 + 60000, end = now + 49 * 3600000;
    at < end;
    at += 60000
  ) {
    const date = new Date(at + offset(t.timezone, at) * 60000);
    const clock = `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
    if (t.times.includes(clock)) return at;
  }
  throw new Error("无法计算下一次检测时间");
}
function text(v, max = 100) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function host(v) {
  if (!isHost(v)) throw new Error("目标必须是域名或 IP");
  return v;
}
function normalizePolicy(input) {
  if (!input || !["routes", "speed", "websites"].includes(input.kind))
    throw new Error("检测用途无效");
  const clients = [...new Set(input.clients || [])];
  if (
    clients.length > 2000 ||
    clients.some((x) => typeof x !== "string" || !UUID.test(x))
  )
    throw new Error("VPS 范围无效");
  const groups = [
    ...new Set((input.groups || []).map((x) => text(x)).filter(Boolean)),
  ];
  if ((!clients.length && !groups.length) || groups.length > 100)
    throw new Error("请选择 VPS 或分组");
  const sources = [...new Set(input.sources || [])];
  if (
    sources.length > 24 ||
    sources.some((x) => typeof x !== "string" || !UUID.test(x))
  )
    throw new Error("大陆探针无效");
  if (
    input.kind === "speed" &&
    (!sources.length || input.trafficAccepted !== true)
  )
    throw new Error("全速测速需选择授权大陆探针并确认流量");
  let sites = (input.sites || WEBSITES.slice(0, 6)).map(host);
  if (!sites.length || sites.length > 24) throw new Error("网站数量需为 1–24");
  const family = input.family || "4",
    protocol = input.protocol || "tcp";
  if (!["4", "6"].includes(family) || !["tcp", "icmp"].includes(protocol))
    throw new Error("协议或地址族无效");
  const seconds = Number(input.seconds || 10),
    streams = Array.isArray(input.streams)
      ? [...new Set(input.streams)]
      : [1, 4];
  if (
    !Number.isInteger(seconds) ||
    seconds < 5 ||
    seconds > 20 ||
    !Array.isArray(streams) ||
    !streams.length ||
    streams.length > 2 ||
    streams.some((x) => ![1, 4, 8].includes(x))
  )
    throw new Error("测速参数无效");
  return {
    id: UUID.test(input.id || "") ? input.id : crypto.randomUUID(),
    name:
      text(input.name) ||
      {
        routes: "大陆双向线路",
        speed: "大陆双向测速",
        websites: "国际网站体验",
      }[input.kind],
    kind: input.kind,
    clients,
    groups,
    sources,
    sites,
    family,
    protocol,
    seconds,
    streams,
    timing: timing(input.timing, input.kind),
    publicSources: input.publicSources !== false,
    enabled: input.enabled !== false,
    inherit: input.inherit !== false,
    trafficAccepted: input.trafficAccepted === true,
  };
}
function members(p, inventory) {
  return inventory
    .filter((n) => p.clients.includes(n.uuid) || p.groups.includes(n.group))
    .map((n) => n.uuid);
}
function routeTargets(family) {
  return CATALOG.find((x) => x.id === "china-route").items.filter(
    (x) =>
      x.id.startsWith(`pek_ipv${family}_`) &&
      [4134, 4837, 9808].some((a) => x.id.endsWith("_" + a)),
  );
}
function planJobs(policy, uuid, endpoint, probes) {
  function address(value) {
    if (!value) return "";
    if (
      (value.includes(":") && policy.family !== "6") ||
      (/^[0-9.]+$/.test(value) && policy.family !== "4")
    )
      return "";
    return value;
  }
  const jobs = [],
    common = {
      policyId: policy.id,
      nodeUuid: uuid,
      options: {
        family: policy.family,
        protocol: policy.protocol,
        quality: true,
      },
    };
  const add = (operation, executor, target, source, direction, extra = {}) =>
    jobs.push({
      ...common,
      operation,
      executor,
      target,
      source,
      direction,
      ...extra,
      options: { ...common.options, ...extra.options },
    });
  if (policy.kind === "websites")
    for (const target of policy.sites)
      add(
        "website",
        `node:${uuid}`,
        target,
        { provider: "runner", name: "当前 VPS" },
        "VPS→网站",
      );
  if (policy.kind === "routes") {
    for (const id of policy.sources) {
      const probe = probes[id];
      if (!probe) continue;
      const source = {
        provider: "controlled",
        id,
        name: probe.name,
        city: probe.city,
        carrier: probe.carrier,
        accessType: probe.accessType,
      };
      add(
        "route",
        `probe:${id}`,
        address(endpoint?.address),
        source,
        "大陆→VPS",
        { pairId: `${policy.id}:${uuid}:${id}` },
      );
      add(
        "route",
        `node:${uuid}`,
        address(probe.publicAddress),
        source,
        "VPS→大陆",
        { pairId: `${policy.id}:${uuid}:${id}` },
      );
    }
    if (policy.publicSources) {
      for (const carrier of CARRIERS)
        add(
          "globalping",
          "globalping",
          address(endpoint?.address),
          {
            provider: "Globalping",
            country: "CN",
            carrier: carrier.name,
            asn: carrier.asn,
          },
          "大陆→VPS",
        );
      for (const target of routeTargets(policy.family))
        add(
          "route",
          `node:${uuid}`,
          target.target,
          {
            provider: "NextTrace 公开目标",
            carrier: target.carrier,
            city: target.region,
          },
          "VPS→大陆",
        );
    }
  }
  if (policy.kind === "speed")
    for (const id of policy.sources)
      if (probes[id])
        add(
          "benchmark",
          `probe:${id}`,
          address(endpoint?.address),
          {
            provider: "controlled",
            id,
            name: probes[id].name,
            carrier: probes[id].carrier,
            city: probes[id].city,
            accessType: probes[id].accessType,
          },
          "大陆↔VPS",
          {
            options: {
              family: policy.family,
              seconds: policy.seconds,
              streams: policy.streams,
              port: endpoint?.port || 25201,
            },
          },
        );
  return jobs;
}
function fingerprint(job) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify([
        job.nodeUuid,
        job.operation,
        job.target,
        job.executor,
        job.source,
        job.direction,
        job.options,
      ]),
    )
    .digest("hex")
    .slice(0, 24);
}
function validateResult(data, kind) {
  const bad = () => {
    throw new Error("原生报告格式无效");
  };
  const number = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0;
  if (
    !data ||
    data.kind !== kind ||
    !["ok", "partial", "failed", "application"].includes(data.state) ||
    JSON.stringify(data).length > 48000 ||
    (data.diagnostic !== undefined && typeof data.diagnostic !== "string")
  )
    bad();
  if (data.state === "application" && kind !== "website") bad();
  if (
    kind === "route" &&
    data.hops !== undefined &&
    (!Array.isArray(data.hops) ||
      data.hops.length > 64 ||
      data.hops.some(
        (h) =>
          !h ||
          !Number.isInteger(h.ttl) ||
          h.ttl < 1 ||
          h.ttl > 64 ||
          typeof h.address !== "string" ||
          typeof h.asn !== "string" ||
          (h.rttMs !== null && !number(h.rttMs)),
      ))
  )
    bad();
  if (
    kind === "website" &&
    ["ok", "application"].includes(data.state) &&
    (!Number.isInteger(data.httpStatus) ||
      data.httpStatus < 100 ||
      data.httpStatus > 599 ||
      !data.timingsMs ||
      ["dns", "connect", "tls", "ttfb", "total"].some(
        (k) => !number(data.timingsMs[k]),
      ))
  )
    bad();
  if (
    kind === "speed" &&
    data.runs !== undefined &&
    (!Array.isArray(data.runs) ||
      data.runs.length > 4 ||
      data.runs.some(
        (r) =>
          !r ||
          !["source-to-target", "target-to-source"].includes(r.direction) ||
          ![1, 4, 8].includes(r.streams) ||
          !["ok", "failed"].includes(r.state) ||
          (r.state === "ok" &&
            (!number(r.bitsPerSecond) ||
              !number(r.bytes) ||
              !number(r.seconds))),
      ))
  )
    bad();
  return data;
}
module.exports = {
  validateResult,
  WEBSITES,
  CARRIERS,
  TIMEZONES,
  offset,
  timing,
  next,
  normalizePolicy,
  members,
  planJobs,
  fingerprint,
  host,
  text,
};
