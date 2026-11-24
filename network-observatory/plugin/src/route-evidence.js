// A network observation is not an attestation of a purchased service product.
const rules = require("./route-networks.json");
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
        description: rule.description, known: false, basis: "registry-prefix", ttls: [],
        source: rule.sourceUrl, ruleVersion: rules.version });
      rows.get(key).ttls.push(ttl);
    }
  }
  return [...rows.values()];
}
function evidenceLabels(networks) {
  const asnRows = networks.filter(row => row.basis === "asn");
  const known = asnRows.filter(row => row.known);
  return {
    labels: [...new Set(networks.map(row => row.label))],
    headlineLabels: [...new Set((known.length ? known : asnRows).map(row => row.label))],
    registryLabels: [...new Set(networks.filter(row => row.basis === "registry-prefix").map(row => row.label))],
  };
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
function reviseRouteFacts(facts) {
  if (!Array.isArray(facts?.networks) || facts.ruleVersion === rules.version) return facts;
  const networks = facts.networks.map(row => {
    const rule = row.basis === "registry-prefix" && rules.prefixes.find(prefix => row.id === "prefix:" + prefix.id);
    return rule ? { ...row, label: rule.label, description: rule.description, known: false, ruleVersion: rules.version } : row;
  });
  return { ...facts, networks, ...evidenceLabels(networks), ruleVersion: rules.version };
}
module.exports = { networkEvidence, routeFacts, reviseRouteFacts, asNumbers };
