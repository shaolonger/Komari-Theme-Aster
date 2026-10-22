// Curated, versioned metadata. Never execute commands or download target lists from these sources.
const CATALOG_VERSION = "2026-09-28.3";
const routeSource = "https://github.com/nxtrace/NTrace-core/blob/7ff73b2c51f9f37a9bc1d6139b7053948f0250db/fast_trace/basic.go";
const regions = { pek: "北京", sha: "上海", can: "广州", hgh: "杭州", hfe: "合肥" };
const carriers = { 4134: "电信 163", 4809: "电信 CN2", 4837: "联通 169", 9929: "联通 9929", 9808: "移动 CMNET", 58807: "移动 CMIN2", 4538: "教育网", 7497: "科技网" };
const routeAvailability = {
  pek: { ipv4: [4134, 4809, 4837, 9929, 9808, 58807, 4538, 7497], ipv6: [4134, 4837, 9808, 4538, 7497] },
  sha: { ipv4: [4134, 4809, 4837, 9929, 9808, 58807, 4538], ipv6: [4134, 4837, 9929, 9808, 4538] },
  can: { ipv4: [4134, 4809, 4837, 9929, 9808, 58807, 4538], ipv6: [4134, 4837, 9808, 4538] },
  hgh: { ipv4: [4134, 4837, 9808, 4538], ipv6: [4134, 4837, 9808, 4538] },
  hfe: { ipv4: [4538, 7497], ipv6: [4538] },
};
const routeItems = Object.entries(routeAvailability).flatMap(([regionCode, families]) =>
  Object.entries(families).flatMap(([family, asns]) => asns.map((asn) => ({
    id: `${regionCode}_${family}_${asn}`,
    name: `${regions[regionCode]} ${carriers[asn]} · ${family.toUpperCase()}`,
    mode: "route",
    target: `${family}.${regionCode}-${asn}.endpoint.nxtrace.org`,
    carrierId: [4134,4809].includes(asn) ? "telecom" : [4837,9929].includes(asn) ? "unicom" : [9808,58807].includes(asn) ? "mobile" : "",
    carrier: carriers[asn], region: regions[regionCode], intervalMinutes: 1440,
  }))));
const CATALOG = [{ id: "china-route", source: routeSource, items: routeItems }];
module.exports = { CATALOG, CATALOG_VERSION };
