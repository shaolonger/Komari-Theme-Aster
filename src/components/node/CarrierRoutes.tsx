import { memo, useState } from "react";
import { useHomeRoutes } from "@/hooks/useHomeRoutes";
import { type RouteEvidence } from "@/services/homeRoutes";
import { formatDisplayDateTime } from "@/utils/timeDisplay";

function Evidence({ value, direction, timeZone }: { value: RouteEvidence | null; direction: string; timeZone: string }) {
  const state = value?.state || "missing";
  const title = value ? `${direction} · ${value.label} · ${value.asns.map(a => `AS${a}`).join(' → ')} · ${formatDisplayDateTime(Date.parse(value.at), timeZone, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} · ${value.samples} 组观测${state === 'partial' ? ' · 路径不完整' : state === 'stale' ? ' · 超过24小时' : ''}` : `${direction}尚无探测结果`;
  return <span className="carrier-route-evidence" data-state={state} title={title} aria-label={title}>{value?.label || "未探测"}{state === "stale" && <small>过期</small>}{state === "partial" && <small>部分</small>}</span>;
}
export const CarrierRoutes = memo(function CarrierRoutes({ uuid, compact = false }: { uuid: string; compact?: boolean }) {
  const [family, setFamily] = useState<"4" | "6">("4");
  const routes = useHomeRoutes();
  const { displayTimeZone, isSlate } = routes;
  const node = routes.data?.nodes[uuid];
  // Empty routes stay out of existing compact dashboards. The reference theme
  // always retains this area, with an honest empty state.
  if (!node && !isSlate) return null;
  const rows = node?.[family] || ["电信", "联通", "移动"].map(carrier => ({ carrier, forward: null, return: null }));
  return <section className="carrier-routes" data-compact={compact} aria-label="三网线路">
    <header className="carrier-routes-head"><strong>三网线路</strong><div className="carrier-family-switch" role="group" aria-label="线路地址族">{(["4", "6"] as const).map(f => <button key={f} type="button" aria-pressed={family === f} onClick={() => setFamily(f)}>IPv{f}</button>)}</div></header>
    <div className="carrier-routes-columns" aria-hidden><span/><span>去程</span><span/><span>回程</span></div>
    {rows.map(row => <div className="carrier-route-row" key={row.carrier}><strong>{row.carrier}</strong><Evidence value={row.forward} direction={`${row.carrier} IPv${family} 去程（大陆→VPS）`} timeZone={displayTimeZone}/><span className="carrier-route-arrow" aria-hidden>⇄</span><Evidence value={row.return} direction={`${row.carrier} IPv${family} 回程（VPS→大陆）`} timeZone={displayTimeZone}/></div>)}
    {!node && <p className="carrier-routes-empty">{routes.isPending ? "正在读取线路…" : routes.isError ? "线路暂不可用，稍后刷新重试" : routes.data?.available ? "尚未发布线路 · 请在网络观测中配置并发布" : "需安装网络观测插件 1.8.0 并发布线路"}</p>}
  </section>;
});
