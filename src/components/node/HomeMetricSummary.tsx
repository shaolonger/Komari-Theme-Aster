import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowDown, ArrowUp, CalendarClock, Gauge, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Flag } from "@/components/ui/Flag";
import { formatByteRateLabel, formatBytes, getExpireDaysRemaining } from "@/utils/format";
import type { HomeOverviewNode, HomeTrafficOverviewRow } from "@/utils/trafficOverview";

export type HomeMetricPanel = "bandwidth" | "traffic" | "expiry";
export type HomeTrafficTab = "today" | "month" | "total";

interface HomeMetricSummaryProps {
  open: boolean;
  panel: HomeMetricPanel | null;
  nodes: HomeTrafficOverviewRow[];
  trafficLoading: boolean;
  trafficError: boolean;
  trafficTab: HomeTrafficTab;
  onTrafficTabChange: (tab: HomeTrafficTab) => void;
  onOpenChange: (open: boolean) => void;
}

function panelTitle(panel: HomeMetricPanel) {
  if (panel === "bandwidth") return "实时带宽排行";
  if (panel === "traffic") return "流量排行";
  return "7 天到期排行";
}

function statusLabel(online: boolean | null) {
  if (online === true) return "在线";
  if (online === false) return "离线";
  return "等待上报";
}

function expiryLabel(expiredAt: HomeOverviewNode["expiredAt"]) {
  const days = getExpireDaysRemaining(expiredAt);
  if (days == null) return { label: "未设置", days: Number.POSITIVE_INFINITY };
  if (days < 0) return { label: `已过期 ${Math.abs(days)} 天`, days };
  if (days === 0) return { label: "今日到期", days };
  return { label: `${days} 天后到期`, days };
}

function OverviewRow({ node, panel, trafficTab }: { node: HomeTrafficOverviewRow; panel: HomeMetricPanel; trafficTab: HomeTrafficTab }) {
  const metadata = [node.group, node.region].filter(Boolean).join(" · ");
  const expiry = expiryLabel(node.expiredAt);
  const traffic = node[trafficTab === "total" ? "total" : trafficTab];
  return (
    <Link to={`/instance/${node.uuid}`} className="home-overview-row" data-online={node.online === true ? "true" : node.online === false ? "false" : "pending"}>
      <div className="home-overview-row-main">
        <Flag region={node.region} size={14} />
        <span className="home-overview-row-identity">
          <strong>{node.name}</strong>
          <small>{metadata || node.uuid}</small>
        </span>
      </div>
      {panel === "bandwidth" && (
        <div className="home-overview-row-value is-bandwidth">
          <strong>{formatByteRateLabel(node.netUp + node.netDown)}</strong>
          <small><ArrowUp size={10} />{formatByteRateLabel(node.netUp)} <ArrowDown size={10} />{formatByteRateLabel(node.netDown)}</small>
        </div>
      )}
      {panel === "traffic" && (
        <div className="home-overview-row-value">
          <strong>{formatBytes(traffic.total)}</strong>
          <small><ArrowUp size={10} />{formatBytes(traffic.up)} <ArrowDown size={10} />{formatBytes(traffic.down)}</small>
        </div>
      )}
      {panel === "expiry" && (
        <div className="home-overview-row-value" data-expiry-days={expiry.days < 0 ? "expired" : expiry.days <= 7 ? "soon" : "later"}>
          <strong>{expiry.label}</strong>
          <small>{statusLabel(node.online)}</small>
        </div>
      )}
    </Link>
  );
}

export function HomeMetricSummary({
  open,
  panel,
  nodes,
  trafficLoading,
  trafficError,
  trafficTab,
  onTrafficTabChange,
  onOpenChange,
}: HomeMetricSummaryProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const [hiddenTabIndex, setHiddenTabIndex] = useState(-1);
  const rows = useMemo(() => {
    if (!panel) return [];
    return [...nodes].sort((left, right) => {
      if (panel === "bandwidth") return right.netUp + right.netDown - left.netUp - left.netDown || left.name.localeCompare(right.name, "zh-CN");
      if (panel === "traffic") return right[trafficTab === "total" ? "total" : trafficTab].total - left[trafficTab === "total" ? "total" : trafficTab].total || left.name.localeCompare(right.name, "zh-CN");
      const leftDays = expiryLabel(left.expiredAt).days;
      const rightDays = expiryLabel(right.expiredAt).days;
      return leftDays - rightDays || left.name.localeCompare(right.name, "zh-CN");
    });
  }, [nodes, panel, trafficTab]);

  useEffect(() => {
    setHiddenTabIndex(open ? 0 : -1);
    if (!open) return;
    const closeIfOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-home-overview-trigger]")) return;
      onOpenChange(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("pointerdown", closeIfOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onOpenChange, open]);

  if (!panel) return null;
  return (
    <section ref={panelRef} className={`home-overview-panel${open ? " show" : ""}`} aria-label={panelTitle(panel)} aria-hidden={!open}>
      <header className="home-overview-header">
        <div className="home-overview-title">
          {panel === "bandwidth" ? <Gauge size={16} /> : panel === "traffic" ? <Activity size={16} /> : <CalendarClock size={16} />}
          <h3>{panelTitle(panel)}</h3>
        </div>
        <button type="button" className="home-overview-close" onClick={() => onOpenChange(false)} aria-label="关闭总览明细" tabIndex={hiddenTabIndex}><X size={18} /></button>
      </header>
      {panel === "traffic" && (
        <div className="home-overview-tabs" role="tablist" aria-label="流量时间范围">
          {(["today", "month", "total"] as const).map((tab) => (
            <button key={tab} type="button" role="tab" aria-selected={trafficTab === tab} data-active={trafficTab === tab ? "true" : "false"} onClick={() => onTrafficTabChange(tab)} tabIndex={hiddenTabIndex}>
              {tab === "today" ? "今日流量" : tab === "month" ? "本月流量" : "累计流量"}
            </button>
          ))}
        </div>
      )}
      <div className="home-overview-content">
        {panel === "traffic" && trafficLoading && <div className="home-overview-empty">正在加载历史流量…</div>}
        {panel === "traffic" && trafficError && <div className="home-overview-empty">历史流量暂时不可用，当前仍显示实时累计值。</div>}
        {rows.length > 0 ? rows.map((node) => <OverviewRow key={node.uuid} node={node} panel={panel} trafficTab={trafficTab} />) : !trafficLoading && <div className="home-overview-empty">暂无可用数据</div>}
      </div>
    </section>
  );
}
