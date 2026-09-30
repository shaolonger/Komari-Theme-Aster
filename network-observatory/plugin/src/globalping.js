const BASE = "https://api.globalping.io/v1";
async function request(suffix, body) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(BASE + suffix, {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        "user-agent": "Aster-Network-Observatory/1.5",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) {
      const e = new Error("Globalping HTTP " + response.status);
      e.rateLimited = response.status === 429;
      e.noCoverage = response.status === 422;
      throw e;
    }
    const raw = await response.text();
    if (raw.length > (suffix === "/probes" ? 8 * 1024 * 1024 : 2000000))
      throw new Error("Globalping 响应过大");
    return JSON.parse(raw);
  } finally {
    clearTimeout(timer);
  }
}
function normalize(job, payload) {
  const rows = payload.results || [];
  if (!rows.length)
    return [
      {
        source: job.source,
        data: {
          kind: "route",
          state: "missing",
          diagnostic: "此地区/ASN 当前没有可用公共探针",
        },
      },
    ];
  return rows.slice(0, 1).map((row) => {
    const p = row.probe || {},
      r = row.result || {},
      hops = (r.hops || []).slice(0, 64).map((h, i) => ({
        ttl: i + 1,
        address: h.resolvedAddress || "",
        asn: "",
        rttMs:
          (h.timings || []).find((t) => typeof t.rtt === "number")?.rtt ?? null,
      }));
    const matched = p.country === "CN" && p.asn === job.source.asn;
    return {
      source: { ...job.source, ...p, provider: "Globalping" },
      data: {
        kind: "route",
        state: !matched ? "missing" : r.status === "finished" ? "ok" : "failed",
        method: "Globalping",
        protocol: job.options.protocol,
        target: job.target,
        family: job.options.family,
        complete:
          !!hops.length && hops[hops.length - 1].address === r.resolvedAddress,
        hops,
        diagnostic: !matched
          ? "探针返回位置/ASN 与请求条件不一致"
          : String(r.rawOutput || r.rawError || "").slice(0, 8000),
      },
    };
  });
}
function create(job) {
  return request("/measurements", {
    type: "traceroute",
    target: job.target,
    locations: [{ country: "CN", asn: job.source.asn, limit: 1 }],
    measurementOptions: {
      protocol: job.options.protocol.toUpperCase(),
      port: 443,
      ...(!job.target.includes(":") && !/^[0-9.]+$/.test(job.target)
        ? { ipVersion: "IPv" + job.options.family }
        : {}),
    },
  });
}
module.exports = { request, create, normalize };
