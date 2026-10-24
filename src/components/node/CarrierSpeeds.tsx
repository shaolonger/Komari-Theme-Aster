import { lazy, memo, Suspense, useState } from "react";
import { useHomeSpeeds } from "@/hooks/useHomeRoutes";
import { type SpeedValue } from "@/services/homeSpeeds";
import { formatDisplayDateTime } from "@/utils/timeDisplay";
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
  if (!snapshots || data.display === false) return null;
  const family = selectedFamily || (snapshots["4"] ? "4" : "6");
  const node = snapshots[family];
  const showDetails = data.showDetails;
  const heading = <header className="carrier-routes-head"><strong>三网测速</strong>
    <div className="carrier-family-switch" role="group" aria-label="测速地址族">
      {(["4", "6"] as const).map(f => <button key={f} type="button" aria-pressed={family === f} onClick={() => { setFamily(f); setOpen(false); }}>IPv{f}</button>)}
    </div></header>;
  if (!node) return <section className="carrier-routes carrier-speeds" data-compact={compact} aria-label="三网测速">{heading}
    <p className="carrier-routes-empty">{data.backfillPending ? "正在恢复历史测速摘要…" : `IPv${family} 暂无测速结果`}</p></section>;
  const city = node.cities.find(c => c.city === selectedCity) || node.cities.find(c => c.rows.some(r => r.download.bitsPerSecond !== null || r.upload.bitsPerSecond !== null)) || node.cities[0];
  const stale = node.stale;
  const timestamp = formatDisplayDateTime(Date.parse(node.at), displayTimeZone, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return <section className="carrier-routes carrier-speeds" data-compact={compact} aria-label="三网测速">
    {heading}<div className="carrier-speeds-controls">
      <small>P1 单连接</small>
      <select aria-label="测速地区" value={city?.city || "北京"} onChange={event => setCity(event.target.value)}>
        {node.cities.map(c => <option key={c.city} value={c.city}>{c.city}</option>)}
      </select></div>
    <div className="carrier-speeds-columns" aria-hidden><span /><span>↓ 下行 Mbps</span><span>↑ 上行 Mbps</span></div>
    {city?.rows.map(row => <div className="carrier-speed-row" key={row.carrier}>
      <strong>{row.carrier}</strong>
      {(["download", "upload"] as const).map(direction => {
        const value = row[direction], label = direction === "download" ? "下行 · 流入 VPS" : "上行 · 流出 VPS";
        const description = `${row.carrier} ${label}：${speedText(value)}${value.bitsPerSecond === null ? "" : " Mbps"}${showDetails ? " · " + speedStatus(value) : ""} · 点击查看测量说明`;
        return <button key={direction} type="button" className="carrier-route-evidence carrier-speed-value" data-details={showDetails}
          data-state={stale && value.bitsPerSecond !== null ? "stale" : value.state === "ok" && ["estimated", "unspecified"].includes(value.basis) ? "partial" : value.state}
          onClick={() => setOpen(true)} title={description} aria-label={description}>
          <span>{speedText(value)}</span>{showDetails && <small>{speedStatus(value)}</small>}
        </button>;
      })}
    </div>)}
    <p className="carrier-speeds-time"><span>{stale ? "超过 24 小时 · " : "最近测试 · "}</span><time dateTime={node.at} title={timestamp}>{timestamp}</time></p>
    {open && <Suspense fallback={<span role="status">正在打开测速说明…</span>}><Details node={node} city={city?.city || "北京"} timeZone={displayTimeZone} uuid={uuid} admin={data.access === "admin"} onClose={() => setOpen(false)} /></Suspense>}
  </section>;
});
