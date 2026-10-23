import routeNetworks from "../../../network-observatory/plugin/src/route-networks.json";
import type { ReportHop, ReportSample } from "@/services/reportObservatory";

export const reportLabels: Record<string, string> = {
  routes: "大陆路由",
  "tcp-quality": "大陆 TCP 质量",
  "china-speed": "大陆单连接测速",
  international: "国际延迟",
  idc: "IDC 接入延迟",
  "international-speed": "国际单连接测速",
  bgp: "BGP 与 RPKI",
  running: "测量中",
  queued: "排队",
  complete: "完整完成",
  ok: "已完成",
  partial: "部分完成",
  application: "应用响应",
  missing: "缺少覆盖",
  failed: "失败",
  cancelled: "已取消",
};
export function sampleBand(sample?: ReportSample) {
  if (!sample) return "unmeasured";
  if (sample.state !== "ok" || sample.rttMs === null) return "failure";
  return sample.rttMs < 30
    ? "fast"
    : sample.rttMs < 80
      ? "good"
      : sample.rttMs < 150
        ? "fair"
        : sample.rttMs < 250
          ? "slow"
          : "distant";
}
export function foldHops(hops: ReportHop[], fold: boolean): ReportHop[][] {
  if (!fold) return hops.map((h) => [h]);
  const groups: ReportHop[][] = [];
  for (const hop of hops) {
    const previous = groups.at(-1);
    if (
      previous &&
      /^(?:AS)?\d+$/.test(hop.asn) &&
      hop.asn === previous[0].asn &&
      ["network", "location", "whois", "domain", "hostname", "geoSource", "asnSource"].every(
        key => hop[key] === previous[0][key],
      ) &&
      hop.ttl === previous[previous.length - 1].ttl + 1
    )
      previous.push(hop);
    else groups.push([hop]);
  }
  return groups;
}
export function routeEvidence(hops: ReportHop[]) {
  const result = new Map<string, { id: string; asn: string; label: string; ttls: number[]; ruleVersion: string; basis: string; source: string }>();
  for (const hop of hops) {
    for (const asn of [...new Set(hop.asn.replace(/\bAS(?=\d)/gi, "").split(/[\s,/{}]+/).filter(token => /^\d+$/.test(token) && Number(token) > 0 && Number(token) <= 4294967295).map(token => String(Number(token))))]) {
      const rule = routeNetworks.networks.find(r => r.asn === asn), id = "asn:" + asn;
      if (!result.has(id)) result.set(id, { id, asn, label: rule?.description || "观察到 AS" + asn,
        ttls: [], ruleVersion: routeNetworks.version, basis: "ASN", source: hop.asnSource || "探测器 ASN 元数据" });
      result.get(id)!.ttls.push(hop.ttl);
    }
    for (const rule of routeNetworks.prefixes) {
      if (!rule.startsWith.some(prefix => hop.address.startsWith(prefix))) continue;
      const id = "prefix:" + rule.id;
      if (!result.has(id)) result.set(id, { id, asn: "", label: rule.description,
        ttls: [], ruleVersion: routeNetworks.version, basis: "登记地址段", source: rule.sourceUrl });
      result.get(id)!.ttls.push(hop.ttl);
    }
  }
  return [...result.values()];
}
export function hopIdentity(hop: ReportHop) {
  if (!hop.address) return "未响应";
  if (hop.asn) return "AS" + hop.asn.replace(/AS/g, "").replace(/ \/ /g, " / AS");
  return ({ "non-public": "私网或特殊用途地址", "not-found": "ASN 数据源未收录", "lookup-failed": "ASN 查询失败" } as Record<string, string>)[hop.asnStatus || ""] || "尚无 ASN 信息";
}
export function numberText(value: number | null | undefined, digits = 1) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : "—";
}
