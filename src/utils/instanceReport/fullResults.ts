import type { ReportFullResult } from "./model";

const names: Record<string, string> = { hardware_quality: "硬件性能", ip_quality: "IP 质量", net_quality: "网络质量", backroute_trace: "回程路由", header_info: "服务器信息", port: "端口信息", yabs: "硬件基准" };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
export function fullResultUrl(module: string, value: unknown) {
  try {
    const url = new URL(text(value));
    const origins = module === "tcpquality-full" ? ["https://tcpquality.ibsgss.uk"] : module === "nodequality-full" ? ["https://nodequality.com", "https://www.nodequality.com"] : [];
    return origins.includes(url.origin) && /^\/r\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname) && !url.search && !url.hash && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}
function clean(value: unknown, depth = 0): unknown {
  if (depth > 14) return "[内容嵌套过深]";
  if (Array.isArray(value)) return value.map(item => clean(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !/(?:password|passwd|secret|credential|authorization|api[_-]?key|token)/i.test(key)).map(([key, item]) => [key, clean(item, depth + 1)]));
  return value;
}
export function projectFullResult(module: string, roundId: string, measurement: Record<string, unknown>): ReportFullResult | null {
  if (module !== "tcpquality-full" && module !== "nodequality-full") return null;
  const data = object(measurement.data);
  if (!Number.isFinite(Date.parse(text(measurement.completedAt)))) return null;
  const sections: ReportFullResult["sections"] = [];
  let clipped = false;
  const append = (name: string, value: unknown, format: "csv" | "json" | "terminal") => {
    let content = text(value);
    if (!content.trim()) return;
    if (format === "json") {
      try { content = JSON.stringify(clean(JSON.parse(content)), null, 2); }
      catch { format = "terminal"; }
    }
    content = content.replace(/((?:password|passwd|secret|api[_-]?key|(?:access[_-]?)?token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[已隐藏]").replace(/(Authorization\s*:\s*)(?:Bearer\s+)?[^\r\n]+/gi, "$1[已隐藏]");
    if (content.length > 400000 || content.includes("[内容嵌套过深]")) clipped = true;
    sections.push({ name, title: names[name.replace(/\.(?:json|log)$/, "")] || name, format, text: content.slice(0, 400000) });
  };
  if (module === "tcpquality-full") append("检测明细", data.csv, "csv");
  else for (const [name, value] of Object.entries(object(data.sections))) if (/^(?:hardware_quality|ip_quality|net_quality|backroute_trace|header_info|port|yabs)\.(?:json|log)$/.test(name)) append(name, value, name.endsWith(".json") ? "json" : "terminal");
  if (!sections.length || module === "tcpquality-full") append("检测原始输出", data.cleanLog, "terminal");
  const coverage = object(data.coverage);
  return {
    id: `full:${roundId}:${text(measurement.id)}`, roundId, module,
    time: Date.parse(text(measurement.completedAt)), state: text(data.state) || "unknown",
    url: fullResultUrl(module, data.reportUrl), profile: text(data.profile) || text(data.family),
    truncated: Boolean(clipped || data.sectionsTruncated || data.csvTruncated || data.logTruncated), sections,
    ...(["ok", "failed", "skipped", "unknown"].every(key => typeof coverage[key] === "number" && Number.isFinite(coverage[key]) && Number(coverage[key]) >= 0) ? { coverage: Object.fromEntries(["ok", "failed", "skipped", "unknown"].map(key => [key, Number(coverage[key])])) as ReportFullResult["coverage"] } : {}),
  };
}
