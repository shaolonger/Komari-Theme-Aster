import type { RouteEvidence } from "@/services/homeRoutes";

// A presentation policy, not a bandwidth/latency score or product attestation.
// Equal levels across carriers preserve observation order rather than inventing
// an operator quality ranking. No CN2/CTGNet observation is upgraded to GIA.
const priorities: Record<string, number> = {
  CN2: 3, CTGNet: 2, "163": 1,
  "9929": 3, "10099": 2, "4837": 1,
  CMIN2: 3, CMI: 2, "9808": 1,
};
export function routeHeadline(value: RouteEvidence | null, mode: "preferred" | "full" = "preferred") {
  if (!value) return "未探测";
  if (value.state === "missing" || value.observed === 0) return /失败|无覆盖|未探测/.test(value.label) ? value.label : "无覆盖";
  const labels = [...new Set(value.networkLabels?.length ? value.networkLabels : value.label.split(/\s*(?:\+|\/)\s*/).filter(Boolean))];
  if (mode === "full") return labels.join(" + ") || value.displayLabel || value.label;
  return labels.reduce((best, label) => (priorities[label] || 0) > (priorities[best] || 0) ? label : best, labels[0] || value.label);
}
