// A network observation is not an attestation of a purchased service product.
const rules = require("./route-networks.json");
const revertedRule = "2026-11-24.1";
function asNumbers(value) {
  return [...new Set(String(value || "").replace(/\bAS(?=\d)/gi, "").split(/[\s,/{}]+/).filter(token => /^\d+$/.test(token) && Number(token) > 0 && Number(token) <= 4294967295).map(token => String(Number(token))))];
}
function networkEvidence(hops = []) {
  const rows = new Map();
  for (const [index, hop] of hops.entries()) {
    const asns = asNumbers(hop.asn), ttl = hop.ttl || index + 1;
    for (const asn of asns) {
      const rule = rules.networks.find(r => r.asn === asn);
      const key = "asn:" + asn;
      if (!rows.has(key)) rows.set(key, { id: key, asn, label: rule?.label || "AS" + asn,
        description: rule?.description || "观察到 AS" + asn, known: !!rule, basis: "asn", ttls: [],
        source: hop.asnSource || "探测器 ASN 元数据", ruleVersion: rules.version });
      rows.get(key).ttls.push(ttl);
    }
    for (const rule of rules.prefixes || []) {
      if (!rule.startsWith.some(prefix => String(hop.address || "").startsWith(prefix))) continue;
      const key = "prefix:" + rule.id;
      if (!rows.has(key)) rows.set(key, { id: key, asn: "", label: rule.label,
        description: rule.description, known: true, basis: "registry-prefix", ttls: [],
        source: rule.sourceUrl, ruleVersion: rules.version });
      rows.get(key).ttls.push(ttl);
    }
  }
  return [...rows.values()];
}
function routeFacts(hops = []) {
  const networks = networkEvidence(hops);
  const asPath = [];
  for (const hop of hops) {
    const value = asNumbers(hop.asn).join("/") || "?";
    if (asPath[asPath.length - 1] !== value) asPath.push(value);
  }
  return { networks, ...evidenceLabels(networks), asPath, productStatus: "unverified", ruleVersion: rules.version };
}
function evidenceLabels(networks) {
  const labels = [...new Set(networks.map(row => row.label))];
  const knownLabels = [...new Set(networks.filter(row => row.known).map(row => row.label))];
  return { labels, headlineLabels: knownLabels.length ? knownLabels : labels };
}
function restoreRouteFacts(facts) {
  if (facts?.ruleVersion !== revertedRule || !Array.isArray(facts.networks)) return facts;
  const networks = facts.networks.map(row => {
    const rule = row.basis === "registry-prefix" && rules.prefixes.find(prefix => row.id === "prefix:" + prefix.id);
    return rule ? { ...row, label: rule.label, description: rule.description, known: true, ruleVersion: rules.version } : row;
  });
  const { registryLabels: _registryLabels, ...saved } = facts;
  return { ...saved, networks, ...evidenceLabels(networks), ruleVersion: rules.version };
}
function restoreHomeEvidence(evidence) {
  if (evidence.ruleVersion !== revertedRule || !evidence.registryLabels?.includes("CN2-BB")) return evidence;
  const networkLabels = [...new Set([...(evidence.networkLabels || []).filter(label => !/^AS\d+$/.test(label)), "CN2"])];
  return { ...evidence, label: networkLabels.join(" / "), networkLabels };
}
module.exports = { networkEvidence, routeFacts, asNumbers, restoreRouteFacts, restoreHomeEvidence };
