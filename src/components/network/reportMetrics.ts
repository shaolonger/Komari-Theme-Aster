import type { ReportHop, ReportSample } from "@/services/reportObservatory";

export const reportLabels: Record<string, string> = {
  routes: "大陆路由",
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
      hop.ttl === previous[previous.length - 1].ttl + 1
    )
      previous.push(hop);
    else groups.push([hop]);
  }
  return groups;
}
export function routeEvidence(hops: ReportHop[]) {
  const asns = (value: string): string[] => value.match(/\d+/g) || [];
  const evidence = hops.flatMap((h) => asns(h.asn));
  const rules: [string, string][] = [
    ["4809", "观察到 CN2"],
    ["4134", "观察到电信 163"],
    ["9929", "观察到联通 9929"],
    ["4837", "观察到联通 169"],
    ["58807", "观察到 CMIN2"],
    ["9808", "观察到 CMNET"],
  ];
  return rules
    .filter(([asn]) => evidence.includes(asn))
    .map(([asn, label]) => ({
      asn,
      label,
      ttls: hops.filter((h) => asns(h.asn).includes(asn)).map((h) => h.ttl),
      ruleVersion: "2026-09-30.1",
    }));
}
export function numberText(value: number | null | undefined, digits = 1) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : "—";
}
