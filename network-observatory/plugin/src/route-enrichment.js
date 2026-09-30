// BGP origin lookup enriches an observed hop IP; it does not measure the AS path.
const { isHost } = require("./model.js");
function originQuery(address) {
  if (!isHost(address)) return "";
  if (/^[0-9.]+$/.test(address)) {
    const p = address.split(".").map(Number),
      [a, b, c] = p;
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    )
      return "";
    return p.reverse().join(".") + ".origin.asn.cymru.com";
  }
  if (!address.includes(":")) return "";
  const halves = address.toLowerCase().split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const parts =
    halves.length === 2
      ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
      : left;
  if (
    parts.length !== 8 ||
    !/^[23]/.test(parts[0].padStart(4, "0")) ||
    (parseInt(parts[0], 16) === 0x2001 && parseInt(parts[1], 16) === 0xdb8)
  )
    return "";
  return (
    parts
      .map((p) => p.padStart(4, "0"))
      .join("")
      .split("")
      .reverse()
      .join(".") + ".origin6.asn.cymru.com"
  );
}
function txt(value) {
  if (typeof value !== "string") return "";
  const chunks = value.match(/"(?:\\.|[^"\\])*"/g);
  if (!chunks) return value;
  try {
    return chunks.map((x) => JSON.parse(x)).join("");
  } catch {
    return "";
  }
}
function createEnricher({
  fetcher = (...args) => fetch(...args),
  budgetMs = 4000,
} = {}) {
  const cache = new Map(),
    inflight = new Map();
  async function query(name, signal) {
    const old = cache.get(name);
    if (old && old.until > Date.now()) return old.value;
    if (inflight.has(name)) return inflight.get(name);
    const promise = (async () => {
      const response = await fetcher(
        "https://cloudflare-dns.com/dns-query?name=" +
          encodeURIComponent(name) +
          "&type=TXT",
        {
          headers: { accept: "application/dns-json" },
          signal,
          redirect: "error",
        },
      );
      if (!response.ok) throw new Error("ASN 查询 HTTP " + response.status);
      const raw = await response.text();
      if (raw.length > 32768) throw new Error("ASN 响应过大");
      const data = JSON.parse(raw);
      if (data.Status !== 0 && data.Status !== 3)
        throw new Error("ASN DNS 查询失败");
      const answers = (data.Answer || []).filter(
        (a) =>
          a.type === 16 &&
          a.name?.toLowerCase().replace(/\.$/, "") === name.toLowerCase(),
      );
      const value = answers.map((a) => txt(a.data));
      const ttl = answers.length
        ? Math.min(...answers.map((a) => Number(a.TTL) || 60))
        : 60;
      if (cache.size >= 4096) cache.delete(cache.keys().next().value);
      cache.set(name, {
        value,
        queriedAt: new Date().toISOString(),
        until: Date.now() + Math.max(30, Math.min(14400, ttl)) * 1000,
      });
      return value;
    })();
    inflight.set(name, promise);
    try {
      return await promise;
    } finally {
      inflight.delete(name);
    }
  }
  async function enrich(data) {
    if (data.kind !== "route" || !Array.isArray(data.hops)) return data;
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), budgetMs);
    const hops = data.hops.map((h) => ({ ...h }));
    let cursor = 0;
    try {
      await Promise.all(
        Array.from({ length: Math.min(8, hops.length) }, async () => {
          while (cursor < hops.length) {
            const h = hops[cursor++];
            if (!h.address) {
              h.asnStatus = "no-response";
              continue;
            }
            if (h.asn) {
              h.asnStatus = "available";
              continue;
            }
            const name = originQuery(h.address);
            if (!name) {
              h.asnStatus = "non-public";
              continue;
            }
            h.asnSource = "Team Cymru / Cloudflare DoH";
            h.asnQueriedAt = new Date().toISOString();
            if (controller.signal.aborted) {
              h.asnStatus = "lookup-failed";
              continue;
            }
            try {
              const rows = await query(name, controller.signal);
              h.asnQueriedAt = cache.get(name)?.queriedAt || h.asnQueriedAt;
              const fields = rows
                .map((row) => row.split("|").map((x) => x.trim()))
                .filter((p) => /^\d+(?: \d+)*$/.test(p[0]));
              const asns = [
                ...new Set(fields.flatMap((p) => p[0].split(/ +/))),
              ];
              if (!asns.length) {
                h.asnStatus = "not-found";
                continue;
              }
              h.asn = asns.join(" / ");
              h.prefix = fields[0][1] || "";
              h.registryCountry = fields[0][2] || ""; // Registration country is NOT hop geolocation.
              h.asnStatus = "available";
              if (asns.length === 1 && !controller.signal.aborted) {
                try {
                  const names = await query(
                    "AS" + asns[0] + ".asn.cymru.com",
                    controller.signal,
                  );
                  const owner = names
                    .map((row) => row.split("|").map((x) => x.trim()))
                    .find((p) => p[0] === asns[0]);
                  if (owner)
                    h.network = owner.slice(4).join(" | ").slice(0, 160);
                } catch {
                  /* Origin ASN remains valid even if the name query fails. */
                }
              }
            } catch {
              h.asnStatus = "lookup-failed";
            }
          }
        }),
      );
    } finally {
      clearTimeout(timer);
    }
    return { ...data, hops };
  }
  return { enrich };
}
module.exports = { createEnricher, originQuery, txt };
