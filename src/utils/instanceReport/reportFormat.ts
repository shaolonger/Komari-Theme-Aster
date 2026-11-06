import type { ReportModel } from "./model";
export const escapeHtml = (v: unknown) => String(v ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
export function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,c=>`\\u${c.charCodeAt(0).toString(16).padStart(4,"0")}`);
}
export function formatReportValue(v: number | null | undefined, unit = "") {
  if (v == null || !Number.isFinite(v)) return "—";
  if (unit === "B" || unit === "B/s") {
    const n = v > 0 ? Math.min(4,Math.max(0,Math.floor(Math.log(v)/Math.log(1024)))) : 0;
    return `${(v/1024**n).toFixed(2)} ${["B","KiB","MiB","GiB","TiB"][n]}${unit === "B/s" ? "/s" : ""}`;
  }
  return v.toLocaleString("zh-CN",{maximumFractionDigits:2})+(unit?" "+unit:"");
}
export function reportFilename(model: ReportModel, extension: "html" | "json") {
  const name=model.node.name.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g,"-").slice(0,60)||"VPS";
  const format=new Intl.DateTimeFormat("en-CA",{timeZone:model.range.timeZone,year:"numeric",month:"2-digit",day:"2-digit"});
  const stamp=(t:number)=>format.format(t).replace(/[^\d]/g,"");
  return `Aster-${name}-${stamp(model.range.start)}_${stamp(model.range.end)}-${model.reportId.slice(0,8)}.${extension}`;
}
