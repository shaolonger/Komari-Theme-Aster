// Homepage projection: no addresses, probe identities, tokens or raw reports.
const fs = require("fs"),
  path = require("path"),
  crypto = require("crypto");
const { UUID } = require("./model.js");
const CARRIERS = ["电信", "联通", "移动"];
const { routeFacts } = require("./route-evidence.js");
function carrierName(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase();
  // Catalog labels may include the access network (电信 163 / 联通 9929).
  for (const [carrier, aliases] of [
    ["电信", ["电信", "中国电信", "telecom"]],
    ["联通", ["联通", "中国联通", "unicom"]],
    ["移动", ["移动", "中国移动", "mobile"]],
  ]) {
    if (aliases.some((alias) => text === alias || text.startsWith(alias + " ")))
      return carrier;
  }
  return "";
}
function project(result) {
  if (
    !["route", "globalping"].includes(result.operation) ||
    result.data?.kind !== "route"
  )
    return null;
  const carrier = carrierName(
      result.source?.carrierId || result.source?.carrier,
    ),
    family = String(result.options?.family || "");
  const direction =
    result.direction === "大陆→VPS"
      ? "forward"
      : result.direction === "VPS→大陆"
        ? "return"
        : "";
  if (
    !carrier ||
    !["4", "6"].includes(family) ||
    !direction ||
    !Number.isFinite(Date.parse(result.completedAt))
  )
    return null;
  const facts = routeFacts(result.data.hops || []);
  const asns = facts.networks.filter(row => row.basis === "asn").map(row => row.asn);
  const labels = facts.headlineLabels;
  const usable = ["ok", "partial"].includes(result.data.state);
  return {
    carrier,
    family,
    direction,
    evidence: {
      label: usable
        ? labels.join(" / ") || "未识别"
        : result.data.state === "failed"
          ? "测量失败"
          : "无覆盖",
      asns: usable ? asns.slice(0, 64) : [],
      asPath: usable ? facts.asPath : [],
      city: String(result.source?.city || "未声明地区").slice(0, 64),
      provider: String(result.source?.provider || "未声明来源").slice(0, 64),
      protocol: String(result.options?.protocol || "tcp").slice(0, 16),
      ruleVersion: facts.ruleVersion,
      networkLabels: labels,
      at: result.completedAt,
      reportId: result.roundId || "",
      diagnostic: usable
        ? ""
        : String(result.data.diagnostic || "测量未取得有效路径").slice(0, 300),
      complete: usable && result.data.complete === true,
      state: usable
        ? result.data.complete === true
          ? "ok"
          : "partial"
        : "missing",
    },
  };
}
function homeRouteStore(root, isMissingFile, clock = () => Date.now()) {
  const directory = path.join(root, "home-routes"),
    nodes = new Map(),
    dirty = new Set();
  function read(uuid) {
    if (!UUID.test(uuid)) throw new Error("节点 UUID 无效");
    if (nodes.has(uuid)) return nodes.get(uuid);
    const file = path.join(directory, uuid + ".json");
    let node;
    try {
      fs.accessSync(file);
      node = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      if (!isMissingFile(e, file)) throw e;
      node = {};
    }
    nodes.set(uuid, node);
    return node;
  }
  function observe(result, persist = true) {
    const row = project(result);
    if (!row) return;
    const node = read(result.nodeUuid),
      family = (node[row.family] ||= {}),
      carrier = (family[row.carrier] ||= {});
    dirty.add(result.nodeUuid);
    // Keep each city/protocol separately so differing observed routes remain visible.
    const key = crypto
      .createHash("sha256")
      .update(
        JSON.stringify([
          result.source?.id || "",
          result.source?.provider || "",
          result.source?.city || "",
          result.options?.protocol || "",
          result.target,
        ]),
      )
      .digest("hex");
    const records = (carrier[row.direction] ||= {});
    if (!records[key] || records[key].at <= row.evidence.at)
      records[key] = row.evidence;
    const keys = Object.keys(records).sort((a, b) =>
      records[b].at.localeCompare(records[a].at),
    );
    for (const old of keys.slice(250)) delete records[old];
    if (persist) save();
  }
  function save() {
    for (const uuid of dirty) {
      const node = read(uuid);
      for (const family of Object.values(node))
        for (const carrier of Object.values(family))
          for (const direction of Object.values(carrier)) {
            for (const [key, evidence] of Object.entries(direction))
              if (clock() - Date.parse(evidence.at) > 7 * 86400000)
                delete direction[key];
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
      const families = {};
      for (const family of ["4", "6"]) {
        families[family] = CARRIERS.map((carrier) => {
          const row = { carrier };
          for (const direction of ["forward", "return"]) {
            const records = Object.values(
              node[family]?.[carrier]?.[direction] || {},
            )
              .filter((e) => clock() - Date.parse(e.at) <= 7 * 86400000)
              .sort((a, b) => b.at.localeCompare(a.at));
            if (!records.length) {
              row[direction] = null;
              continue;
            }
            const latest = records[0];
            // A card describes one round. Never stitch cities/protocols from older rounds.
            const current = records.filter(e => latest.reportId
              ? e.reportId === latest.reportId : e.at === latest.at);
            const usable = current.filter(e => e.state !== "missing");
            const networkLabels = [...new Set((usable.length ? usable : current).flatMap(e => e.networkLabels?.length ? e.networkLabels : [e.label]))];
            const combinedLabel = networkLabels.join(" / ");
            const confirmed = current.filter(e => e.state === "ok").length;
            const observed = current.filter(e => e.state !== "missing").length;
            row[direction] = {
              label: combinedLabel.length > 160 ? `${networkLabels.length} 个网络（展开）` : combinedLabel,
              asns: [...new Set(current.flatMap((e) => e.asns))].slice(0, 64),
              at: latest.at,
              samples: current.length,
              confirmed, observed,
              variants: [...new Set(current.filter(e => e.state !== "missing").map(e => e.label))].length,
              observations: current.slice(0, 12).map(e => ({ label: e.label, at: e.at, city: e.city || "未声明地区",
                provider: e.provider || "未声明来源", protocol: e.protocol || "未声明协议",
                asPath: e.asPath || [], state: e.state, reportId: e.reportId || "" })),
              reportId: latest.reportId || "",
              diagnostic: latest.diagnostic || "",
              state:
                clock() - Date.parse(latest.at) > 86400000
                  ? "stale"
                  : current.every((e) => e.state === "ok")
                    ? "ok"
                    : current.every((e) => e.state === "missing")
                      ? "missing"
                      : "partial",
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
