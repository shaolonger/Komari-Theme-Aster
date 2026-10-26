import { lazy, memo, Suspense, useState } from "react";
import { useHomeSpeeds } from "@/hooks/useHomeRoutes";
import { type SpeedValue } from "@/services/homeSpeeds";
import { formatDisplayDateTime } from "@/utils/timeDisplay";
import { useCardCheck } from "@/hooks/useCardChecks";
import { CardCheckButton, CardCheckFeedback, completionTone } from "./CardCheckControls";
const Details = lazy(() => import("./CarrierSpeedDetails"));
export function speedText(value: SpeedValue) {
  return value.bitsPerSecond === null ? value.state === "failed" ? "失败" : value.state === "cancelled" ? "已取消" : "未测"
    : (value.bitsPerSecond / 1e6).toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}
export function speedStatus(value: SpeedValue) {
  if (value.bitsPerSecond === null) return "无有效速率";
  return [value.state === "partial" ? "部分" : "", value.basis === "estimated" ? "写入估算" : value.basis === "tcp-acked" ? "TCP 已确认" : value.basis === "receiver" ? "接收端计量" : "计量侧未注明"].filter(Boolean).join(" · ");
}
export const CarrierSpeeds = memo(function CarrierSpeeds({ uuid, compact = false }: { uuid: string; compact?: boolean }) {
  const { data, displayTimeZone } = useHomeSpeeds();
  const [selectedCity, setCity] = useState<string | null>(null), [open, setOpen] = useState(false);
  const [selectedFamily, setFamily] = useState<"4" | "6" | null>(null);
  const snapshots = data?.nodes[uuid];
  const configured = data?.quickFamilies[uuid] || [];
  const family = selectedFamily || (snapshots?.["4"] ? "4" : snapshots?.["6"] ? "6" : configured[0] || "4");
  const check = useCardCheck(uuid,"china-speed",family);
  if (!data || (!snapshots && !configured.length) || data.display === false) return null;
  const node = snapshots?.[family];
  const showDetails = data.showDetails;
  const city = node?.cities.find(c => c.city === selectedCity) || node?.cities.find(c => c.rows.some(r => r.download.bitsPerSecond !== null || r.upload.bitsPerSecond !== null)) || node?.cities[0];
  const heading = <header className="carrier-routes-head"><div className="carrier-observation-title"><strong title="P1 单连接测速">三网测速</strong>
    {node && <select aria-label="测速地区" title="测速地区 · P1 单连接" value={city?.city || "北京"} onChange={event => setCity(event.target.value)}>
      {node.cities.map(c => <option key={c.city} value={c.city}>{c.city}</option>)}
    </select>}</div><div className="carrier-observation-actions">
    <div className="carrier-family-switch" role="group" aria-label="测速地址族">
      {(["4", "6"] as const).map(f => <button key={f} type="button" aria-pressed={family === f} onClick={() => { setFamily(f); setOpen(false); }}>IPv{f}</button>)}
    </div><CardCheckButton check={check} supported={data.quickCheck} configured={configured.includes(family)} uuid={uuid} family={family} label="三网测速" /></div></header>;
  const stale = node?.stale;
  const timestamp = node ? formatDisplayDateTime(Date.parse(node.at), displayTimeZone, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "";
  const missing: SpeedValue = {bitsPerSecond:null,state:"missing",basis:"unavailable"};
  const rows = city?.rows || ["电信","联通","移动"].map(carrier => ({carrier,download:missing,upload:missing}));
  return <section className="carrier-routes carrier-speeds" data-compact={compact} aria-label="三网测速" data-completion={check.celebrate ? completionTone(check) : undefined}>
    {heading}
    <div className="carrier-speeds-columns" aria-hidden><span /><span>↓ 下行 Mbps</span><span>↑ 上行 Mbps</span></div>
    {rows.map(row => <div className="carrier-speed-row" key={row.carrier}>
      <strong>{row.carrier}</strong>
      {(["download", "upload"] as const).map(direction => {
        const value = row[direction], label = direction === "download" ? "下行 · 流入 VPS" : "上行 · 流出 VPS";
        const description = `${row.carrier} ${label}：${speedText(value)}${value.bitsPerSecond === null ? "" : " Mbps"}${showDetails ? " · " + speedStatus(value) : ""} · 点击查看测量说明`;
        return <button key={direction} type="button" className="carrier-route-evidence carrier-speed-value" data-details={showDetails}
          data-state={stale && value.bitsPerSecond !== null ? "stale" : value.state === "ok" && ["estimated", "unspecified"].includes(value.basis) ? "partial" : value.state}
          onClick={() => setOpen(true)} disabled={!node} title={description} aria-label={description}>
          <span>{speedText(value)}</span>{showDetails && <small>{speedStatus(value)}</small>}
        </button>;
      })}
    </div>)}
    <CardCheckFeedback check={check} uuid={uuid}>{node ? <span className="carrier-speeds-time" title={timestamp}><span>{stale ? "过期 · " : "最近测试 "}</span><time dateTime={node.at}>{formatDisplayDateTime(Date.parse(node.at), displayTimeZone, {month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"})}</time></span>
      : data.backfillPending ? "恢复历史摘要中…" : `IPv${family} 暂无测速结果`}</CardCheckFeedback>
    {open && node && <Suspense fallback={<span role="status">正在打开测速说明…</span>}><Details node={node} city={city?.city || "北京"} timeZone={displayTimeZone} uuid={uuid} admin={data.access === "admin"} onClose={() => setOpen(false)} /></Suspense>}
  </section>;
});
