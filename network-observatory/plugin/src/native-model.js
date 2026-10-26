const { UUID, isHost } = require("./model.js");
const tz = require("./timezones.json");
const {
  WEBSITE_CATALOG,
  WEBSITES,
} = require("./website-catalog.js");
const CARRIERS = [
  { id: "telecom", name: "电信", asn: 4134 },
  { id: "unicom", name: "联通", asn: 4837 },
  { id: "mobile", name: "移动", asn: 9808 },
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
function normalizeRange(input) {
  if (input.clients !== undefined && !Array.isArray(input.clients)) throw new Error("VPS 范围无效");
  if (input.groups !== undefined && !Array.isArray(input.groups)) throw new Error("分组范围无效");
  const clients = [...new Set(input.clients || [])], groups = [...new Set((input.groups || []).map(x => text(x)).filter(Boolean))];
  if (clients.length > 2000 || clients.some(x => !UUID.test(x)) || groups.length > 100 || (!clients.length && !groups.length)) throw new Error("请选择有效 VPS 或分组");
  return { clients, groups, inherit: input.inherit !== false };
}
function members(p, inventory) {
  const clients = new Set(p.clients), groups = new Set(p.groups);
  return inventory
    .filter((n) => clients.has(n.uuid) || groups.has(n.group))
    .map((n) => n.uuid);
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
  if (kind === "speed") {
    if (["trafficBytesObserved", "remainingTrafficBytes"].some(k => data[k] !== undefined && !number(data[k])) ||
        (data.retryable !== undefined && typeof data.retryable !== "boolean") ||
        (data.controlRequests !== undefined && (!Array.isArray(data.controlRequests) || data.controlRequests.length > 16 ||
          data.controlRequests.some(r => !r || typeof r.stage !== "string" || !["ok", "failed"].includes(r.state) ||
            !number(r.durationMs) || !Number.isInteger(r.attempt) || r.attempt < 1 || r.attempt > 2)))) bad();
  }
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
          [
            "asnStatus",
            "asnSource",
            "asnQueriedAt",
            "network",
            "location",
            "domain",
            "whois",
            "hostname",
            "geoSource",
            "geoQueriedAt",
            "geoStatus",
            "prefix",
            "registryCountry",
          ].some((k) => h[k] !== undefined && typeof h[k] !== "string") ||
          (h.rttMs !== null && !number(h.rttMs)),
        // Optional MTR fields remain absent on legacy traceroute reports.
      ))
  )
    bad();
  if (kind === "route" && data.metadataObservation !== undefined) {
    const m = data.metadataObservation;
    if (!m || typeof m !== "object" || Array.isArray(m) ||
        ["method", "state", "target", "resolvedIp", "protocol", "parseError", "diagnostic", "conditions", "startedAt", "completedAt", "queriedAt", "stopReason", "stdout", "stderr"].some(k => m[k] !== undefined && typeof m[k] !== "string") ||
        (m.exitCode !== undefined && !Number.isInteger(m.exitCode)) ||
        (m.durationMs !== undefined && !number(m.durationMs)) ||
        (m.matchedIps !== undefined && (!Array.isArray(m.matchedIps) || m.matchedIps.length > 64 || m.matchedIps.some(ip => typeof ip !== "string"))) ||
        (m.hops !== undefined && (!Array.isArray(m.hops) || m.hops.length > 32))) bad();
    if (m.hops) validateResult({ kind: "route", state: "ok", hops: m.hops }, "route");
  }
  if (["website", "latency", "tcp-quality"].includes(kind) && data.tcpQuality != null) {
    const q = data.tcpQuality;
    if (
      typeof q.method !== "string" ||
      typeof q.address !== "string" ||
      !["ok", "partial", "failed", "unavailable"].includes(q.state) ||
      !Number.isInteger(q.sent) ||
      q.sent < 0 ||
      q.sent > 10 ||
      !Number.isInteger(q.received) ||
      q.received < 0 ||
      q.received > q.sent ||
      ["failurePercent", "avgMs", "minMs", "maxMs", "stdevMs"].some(
        (k) => q[k] !== null && !number(q[k]),
      ) ||
      (q.failurePercent !== null && q.failurePercent > 100)
    )
      bad();
    if (
      q.samples !== undefined &&
      (!Array.isArray(q.samples) ||
        q.samples.length !== q.sent ||
        q.samples.some(
          (sample, i) =>
            !sample ||
            sample.index !== i + 1 ||
            !["ok", "timeout", "refused", "failed"].includes(sample.state) ||
            (sample.state === "ok"
              ? !number(sample.rttMs)
              : sample.rttMs !== null) ||
            typeof sample.address !== "string" ||
            typeof sample.error !== "string",
        ) ||
        q.samples.filter((sample) => sample.state === "ok").length !==
          q.received)
    )
      bad();
    if (q.medianMs !== undefined && q.medianMs !== null && !number(q.medianMs))
      bad();
  }
  if (
    ["latency", "tcp-quality"].includes(kind) &&
    (!data.tcpQuality || !Array.isArray(data.tcpQuality.samples))
  )
    bad();
  if (
    kind === "route" &&
    data.hops?.some(
      (h) =>
        [
          "lastMs",
          "avgMs",
          "bestMs",
          "worstMs",
          "stdevMs",
          "sent",
          "received",
          "lossPercent",
        ].some((k) => h[k] !== undefined && h[k] !== null && !number(h[k])) ||
        (h.lossPercent !== undefined && h.lossPercent > 100) ||
        (h.received !== undefined && h.received > h.sent),
    )
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
          !["ok", "partial", "missing", "failed"].includes(r.state) ||
          ["trafficBytesObserved", "warmupBytesObserved", "setupSeconds"].some(k => r[k] !== undefined && !number(r[k])) ||
          (r.attempts !== undefined && (!Array.isArray(r.attempts) || r.attempts.length > 2 || r.attempts.some(a =>
            !a || !["ok", "partial", "failed"].includes(a.state) ||
            (a.trafficBytesObserved != null && !number(a.trafficBytesObserved))))) ||
          (["ok", "partial"].includes(r.state) &&
            (!number(r.bitsPerSecond) ||
              !number(r.bytes) ||
              !number(r.seconds))) ||
          (r.intervals !== undefined &&
            (!Array.isArray(r.intervals) ||
              r.intervals.length > 80 ||
              r.intervals.some(
                (i) =>
                  !i ||
                  !number(i.bitsPerSecond) ||
                  !number(i.seconds) ||
                  i.seconds <= 0,
              ))) ||
          ["tcpRttMs", "retransmits", "maxBitsPerSecond"].some(
            (k) => r[k] !== undefined && r[k] !== null && !number(r[k]),
          ),
      ))
  )
    bad();
  return data;
}
module.exports = {
  validateResult,
  WEBSITES,
  WEBSITE_CATALOG,
  CARRIERS,
  TIMEZONES,
  offset,
  timing,
  next,
  normalizeRange,
  members,
  host,
  text,
};
