import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowDown, ArrowUp, CalendarClock, Gauge, WifiOff, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Flag } from "@/components/ui/Flag";
import { formatByteRateLabel, formatBytes, getExpireDaysRemaining } from "@/utils/format";
import type { HomeOverviewNode, HomeTrafficOverviewRow } from "@/utils/trafficOverview";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { formatDisplayDateTime, type DisplayTimeZone } from "@/utils/timeDisplay";

export type HomeMetricPanel = "status" | "bandwidth" | "traffic" | "expiry";
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
  if (panel === "status") return "VPS 在线状态";
  if (panel === "bandwidth") return "实时带宽排行";
  if (panel === "traffic") return "流量排行";
  return "7 天到期排行";
}

function formatOfflineDuration(updatedAt: number, now: number) {
  if (!updatedAt || updatedAt > now) return "时长未知";
  const minutes = Math.floor((now - updatedAt) / 60_000);
  if (minutes < 1) return "不足 1 分钟";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时 ${minutes % 60} 分钟`;
  const days = Math.floor(hours / 24);
  return `${days} 天 ${hours % 24} 小时`;
}

function formatOfflineAt(updatedAt: number, displayTimeZone: DisplayTimeZone) {
  if (!updatedAt) return "离线时刻未知";
  return `离线于 ${formatDisplayDateTime(updatedAt, displayTimeZone, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })}`;
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

function OverviewRow({ node, panel, trafficTab, now, displayTimeZone, trafficError }: { node: HomeTrafficOverviewRow; panel: HomeMetricPanel; trafficTab: HomeTrafficTab; now: number; displayTimeZone: DisplayTimeZone; trafficError: boolean }) {
  const metadata = [node.group, node.region].filter(Boolean).join(" · ");
  const expiry = expiryLabel(node.expiredAt);
  const traffic = node[trafficTab === "total" ? "total" : trafficTab];
  const trafficUnavailable = trafficTab !== "total" && (trafficError || traffic.quality === "unavailable");
  const trafficCoverage = traffic.coverageStart == null
    ? null
    : formatDisplayDateTime(traffic.coverageStart, displayTimeZone, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
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
      {panel === "status" && (
        <div className="home-overview-row-value is-status">
          <strong>{statusLabel(node.online)}{node.online === false ? ` · ${formatOfflineDuration(node.updatedAt, now)}` : ""}</strong>
          <small>{node.online === false ? formatOfflineAt(node.updatedAt, displayTimeZone) : node.online === true ? "状态正常" : "等待首次上报"}</small>
        </div>
      )}
      {panel === "traffic" && (
        <div className="home-overview-row-value">
          <strong>{trafficUnavailable ? "—" : formatBytes(traffic.total)}</strong>
          <small>
            {trafficUnavailable
              ? "周期用量暂不可计算"
              : trafficTab === "total"
                ? "累计计数"
                : traffic.quality === "partial"
                  ? `部分覆盖，自 ${trafficCoverage ?? "首条样本"}`
                  : "周期边界样本可用"}
          </small>
          {!trafficUnavailable && <small><ArrowUp size={10} />{formatBytes(traffic.up)} <ArrowDown size={10} />{formatBytes(traffic.down)}</small>}
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
  const [clock, setClock] = useState(() => Date.now());
  const { displayTimeZone } = useThemeSettings();
  const rows = useMemo(() => {
    if (!panel) return [];
    return [...nodes].sort((left, right) => {
      if (panel === "status") {
        const rank = (online: boolean | null) => online === false ? 0 : online == null ? 1 : 2;
        const statusDelta = rank(left.online) - rank(right.online);
        if (statusDelta !== 0) return statusDelta;
        if (left.online === false && right.online === false) {
          return (left.updatedAt || Number.POSITIVE_INFINITY) - (right.updatedAt || Number.POSITIVE_INFINITY) || left.name.localeCompare(right.name, "zh-CN");
        }
        return left.name.localeCompare(right.name, "zh-CN");
      }
      if (panel === "bandwidth") return right.netUp + right.netDown - left.netUp - left.netDown || left.name.localeCompare(right.name, "zh-CN");
      if (panel === "traffic") return right[trafficTab === "total" ? "total" : trafficTab].total - left[trafficTab === "total" ? "total" : trafficTab].total || left.name.localeCompare(right.name, "zh-CN");
      const leftDays = expiryLabel(left.expiredAt).days;
      const rightDays = expiryLabel(right.expiredAt).days;
      return leftDays - rightDays || left.name.localeCompare(right.name, "zh-CN");
    });
  }, [nodes, panel, trafficTab]);

  useEffect(() => {
    if (!open || panel !== "status") return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [open, panel]);

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
          {panel === "status" ? <WifiOff size={16} /> : panel === "bandwidth" ? <Gauge size={16} /> : panel === "traffic" ? <Activity size={16} /> : <CalendarClock size={16} />}
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
        {panel === "traffic" && trafficError && trafficTab !== "total" && <div className="home-overview-empty">历史读取失败，所选周期用量不可计算；可切换到累计流量查看当前计数。</div>}
        {rows.length > 0 ? rows.map((node) => <OverviewRow key={node.uuid} node={node} panel={panel} trafficTab={trafficTab} now={clock} displayTimeZone={displayTimeZone} trafficError={trafficError} />) : !trafficLoading && <div className="home-overview-empty">暂无可用数据</div>}
      </div>
    </section>
  );
}
