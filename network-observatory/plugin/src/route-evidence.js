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
        description: rule.description, known: true, basis: "registry-prefix", ttls: [],
        source: rule.sourceUrl, ruleVersion: rules.version });
      rows.get(key).ttls.push(ttl);
    }
  }
  return [...rows.values()];
}
function routeFacts(hops = []) {
  const networks = networkEvidence(hops), labels = [];
  for (const row of networks) if (!labels.includes(row.label)) labels.push(row.label);
  const knownLabels = [...new Set(networks.filter(row => row.known).map(row => row.label))];
  const asPath = [];
  for (const hop of hops) {
    const value = asNumbers(hop.asn).join("/") || "?";
    if (asPath[asPath.length - 1] !== value) asPath.push(value);
  }
  return { networks, labels, headlineLabels: knownLabels.length ? knownLabels : labels, asPath, productStatus: "unverified", ruleVersion: rules.version };
}
module.exports = { networkEvidence, routeFacts, asNumbers };
