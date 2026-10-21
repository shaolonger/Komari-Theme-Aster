// Homepage projection: no addresses, probe identities, tokens or raw reports.
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const { UUID } = require("./model.js");
const CARRIERS = ["电信", "联通", "移动"];
// These labels describe observed ASNs, never a commercial GIA guarantee.
const NETWORKS = {
  电信: [["4809", "CN2"], ["4134", "163"]],
  联通: [["9929", "9929"], ["10099", "10099"], ["4837", "4837"]],
  移动: [["58807", "CMIN2"], ["58453", "CMI"], ["9808", "9808"]],
};
function carrierName(value) {
  const aliases = { 电信: "电信", 中国电信: "电信", telecom: "电信", 联通: "联通", 中国联通: "联通", unicom: "联通", 移动: "移动", 中国移动: "移动", mobile: "移动" };
  return aliases[String(value || "").trim().toLowerCase()] || "";
}
function project(result) {
  if (result.operation !== "route" || result.data?.kind !== "route") return null;
  const carrier = carrierName(result.source?.carrier), family = String(result.options?.family || "");
  const direction = result.direction === "大陆→VPS" ? "forward" : result.direction === "VPS→大陆" ? "return" : "";
  if (!carrier || !["4", "6"].includes(family) || !direction || !Number.isFinite(Date.parse(result.completedAt))) return null;
  const asns = [...new Set((result.data.hops || []).map(h => String(h.asn || "").replace(/^AS/i, "").trim()).filter(a => /^\d+$/.test(a)))];
  const labels = NETWORKS[carrier].filter(([asn]) => asns.includes(asn)).map(([, label]) => label);
  const usable = ["ok", "partial"].includes(result.data.state);
  return { carrier, family, direction, evidence: {
    label: usable ? labels.join(" / ") || "未识别" : "未探测",
    asns: usable ? asns.slice(0, 64) : [], at: result.completedAt,
    complete: usable && result.data.complete === true,
    state: usable ? (result.data.complete === true ? "ok" : "partial") : "missing",
  } };
}
function homeRouteStore(root, isMissingFile, clock = () => Date.now()) {
  const directory = path.join(root, "home-routes"), nodes = new Map(), dirty = new Set();
  function read(uuid) {
    if (!UUID.test(uuid)) throw new Error("节点 UUID 无效");
    if (nodes.has(uuid)) return nodes.get(uuid);
    const file = path.join(directory, uuid + ".json");
    let node;
    try { fs.accessSync(file); node = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (e) { if (!isMissingFile(e, file)) throw e; node = {}; }
    nodes.set(uuid, node);
    return node;
  }
  function observe(result, persist = true) {
    const row = project(result);
    if (!row) return;
    const node = read(result.nodeUuid), family = node[row.family] ||= {}, carrier = family[row.carrier] ||= {};
    dirty.add(result.nodeUuid);
    // Keep each city/protocol separately so differing observed routes remain visible.
    const key = crypto.createHash("sha256").update(JSON.stringify([result.source?.id || "", result.source?.provider || "", result.source?.city || "", result.options?.protocol || "", result.target])).digest("hex");
    const records = carrier[row.direction] ||= {};
    if (!records[key] || records[key].at <= row.evidence.at) records[key] = row.evidence;
    const keys = Object.keys(records).sort((a, b) => records[b].at.localeCompare(records[a].at));
    for (const old of keys.slice(12)) delete records[old];
    if (persist) save();
  }
  function save() {
    for (const uuid of dirty) {
      const node = read(uuid);
      for (const family of Object.values(node)) for (const carrier of Object.values(family)) for (const direction of Object.values(carrier)) {
        for (const [key, evidence] of Object.entries(direction)) if (clock() - Date.parse(evidence.at) > 7 * 86400000) delete direction[key];
      }
      const file = path.join(directory, uuid + ".json");
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(file + ".tmp", JSON.stringify(node), { mode: 0o600 });
      fs.renameSync(file + ".tmp", file);
    }
    dirty.clear();
  }
  function summary(allowed) {
    const output = {};
    for (const uuid of allowed) {
      const node = read(uuid);
      if (!Object.keys(node).length) continue;
      const families = {};
      for (const family of ["4", "6"]) {
        families[family] = CARRIERS.map(carrier => {
          const row = { carrier };
          for (const direction of ["forward", "return"]) {
            const records = Object.values(node[family]?.[carrier]?.[direction] || {}).filter(e => clock() - Date.parse(e.at) <= 7 * 86400000).sort((a, b) => b.at.localeCompare(a.at));
            if (!records.length) { row[direction] = null; continue; }
            const latest = records[0];
            // Only combine measurements from the same observation day.
            const current = records.filter(e => e.at.slice(0, 10) === latest.at.slice(0, 10));
            row[direction] = {
              label: [...new Set(current.map(e => e.label))].join(" · "),
              asns: [...new Set(current.flatMap(e => e.asns))].slice(0, 64),
              at: latest.at, samples: current.length,
              state: clock() - Date.parse(latest.at) > 86400000 ? "stale" : current.every(e => e.state === "ok") ? "ok" : current.every(e => e.state === "missing") ? "missing" : "partial",
            };
          }
          return row;
        });
      }
      output[uuid] = families;
    }
    return output;
  }
  return { observe, save, summary };
}
module.exports = { project, homeRouteStore, carrierName };
