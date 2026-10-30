import {
  useEffect,
  useMemo,
  useRef,
  type ComponentProps,
  type CSSProperties,
} from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  CalendarClock,
  ChevronRight,
  LayoutGrid,
  List,
  Rows3,
  Search,
  Settings2,
  Wallet,
} from "lucide-react";
import type OrbitalHome from "@/components/orbital/OrbitalHome";
import { useViewMode } from "@/hooks/useViewMode";
import { Flag } from "@/components/ui/Flag";
import { FleetThroughput } from "@/components/workspace/FleetThroughput";
import { getDisplayRegionCode } from "@/utils/geo";
import { formatByteRateLabel } from "@/utils/format";
import { formatCnyMoney } from "@/utils/cost";
import { regionLabel } from "@/components/glacier/regionLabel";
import LuminousScene from "./LuminousScene";

const views = [
  { value: "standard", label: "标准卡片", icon: LayoutGrid },
  { value: "compact", label: "紧凑卡片", icon: Rows3 },
  { value: "large", label: "大卡片", icon: LayoutGrid },
  { value: "list", label: "列表", icon: List },
] as const;
export default function LuminousHome(
  props: ComponentProps<typeof OrbitalHome>,
) {
  const {
    nodes,
    summaries,
    risks,
    search,
    onSearch,
    toolsOpen,
    onToggleTools,
    status,
    onStatus,
    todayTraffic,
    costSummary,
    costLoading,
    onOpenMetric,
    onOpenCost,
    showOverview,
    showCost,
    region,
    onRegion,
    group,
    onGroup,
  } = props;
  const { mode, setMode } = useViewMode();
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  const online = summaries.filter((n) => n.online === true).length;
  const attention = new Set(risks.map((r) => r.uuid)).size;
  const ratio = nodes.length ? (online / nodes.length) * 100 : 0;
  const up = summaries.reduce((s, n) => s + n.netUp, 0),
    down = summaries.reduce((s, n) => s + n.netDown, 0);
  const regions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) {
      const code = getDisplayRegionCode(node.region);
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [nodes]);
  const groups = [...new Set(nodes.map((n) => n.group).filter(Boolean))];
  const expiring = risks.filter((r) => r.kind === "expiry");
  return (
    <>
      <header className="luminous-home-heading">
        <label className="luminous-search">
          <Search size={18} />
          <input
            ref={searchInput}
            type="search"
            aria-label="搜索 VPS"
            placeholder="搜索 VPS、名称、IP、标签…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
          <kbd>⌘ K</kbd>
        </label>
        <span>
          光域未来 <i /> 实时云端监控
        </span>
      </header>
      {showOverview && (
        <section className="luminous-hero" aria-label="全网运行状态">
          <LuminousScene />
          <div className="luminous-hero-left">
            <button
              className="luminous-glass luminous-global"
              data-home-overview-trigger
              onClick={() => onOpenMetric("status")}
            >
              <span>
                <small>全球节点</small>
                <strong>
                  {online} <em>/ {nodes.length}</em>
                </strong>
                <p>
                  <i />
                  {ratio.toFixed(1)}% 在线率
                </p>
              </span>
              <span
                className="luminous-online-ring"
                style={{ "--ring": ratio + "%" } as CSSProperties}
              >
                <b>
                  {ratio.toFixed(1)}%<small>在线率</small>
                </b>
              </span>
            </button>
            <div className="luminous-glass luminous-bandwidth">
              <button
                data-home-overview-trigger
                onClick={() => onOpenMetric("bandwidth")}
              >
                <small>实时总带宽</small>
                <strong>{formatByteRateLabel(up + down)}</strong>
              </button>
              <FleetThroughput summaries={summaries} />
              <p>
                <span>
                  <ArrowUp size={13} />
                  {formatByteRateLabel(up)}
                </span>
                <span>
                  <ArrowDown size={13} />
                  {formatByteRateLabel(down)}
                </span>
              </p>
            </div>
          </div>
          <div className="luminous-region-tags" aria-label="节点地区分布">
            {regions.slice(0, 7).map(([code, count]) => (
              <button
                key={code}
                onClick={() => onRegion(region === code ? "" : code)}
                aria-pressed={region === code}
                title={regionLabel(code) + " · " + count + " 个节点"}
              >
                <Flag region={code} size={18} />
                {code} <b>{count}</b>
              </button>
            ))}
            <small>节点地区分布</small>
          </div>
          <div className="luminous-hero-right">
            <button
              className="luminous-glass luminous-total"
              title={todayTraffic.detail}
              data-home-overview-trigger
              onClick={() => onOpenMetric("traffic")}
            >
              <small>今日流量</small>
              <strong>{todayTraffic.label}</strong>
              <span className="luminous-mini-bars" aria-hidden="true">
                {[2, 4, 3, 6, 5, 8, 10].map((h, i) => (
                  <i
                    key={i}
                    style={{ height: h * 5 + "px", "--i": i } as CSSProperties}
                  />
                ))}
              </span>
              <p>
                点击查看真实流量采样 <ChevronRight size={12} />
              </p>
            </button>
            {showCost && (
              <button
                className="luminous-glass luminous-assets"
                aria-label="资产统计"
                onClick={onOpenCost}
              >
                <small>
                  剩余资产 <Wallet size={14} />
                </small>
                <strong>
                  {costSummary
                    ? formatCnyMoney(costSummary.remainingCny)
                    : costLoading
                      ? "计算中"
                      : "—"}
                </strong>
                <div className="luminous-asset-orbit" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
                <p>
                  <span>{expiring.length} 项到期事项</span>
                  <span>{attention} 个关注节点</span>
                </p>
              </button>
            )}
          </div>
          <aside className="luminous-glass luminous-notices">
            <section>
              <h2>
                <Bell size={14} />
                当前关注 <b>{attention}</b>
              </h2>
              {risks.slice(0, 3).map((risk, i) => (
                <Link
                  key={risk.uuid + "-" + i}
                  to={
                    "/instance/" +
                    encodeURIComponent(risk.uuid) +
                    "?focus=" +
                    (risk.evidenceTarget ?? "status")
                  }
                >
                  <i data-tone={risk.severity} />
                  <span>
                    <strong>{risk.name}</strong>
                    <small>
                      {risk.title} · {risk.detail}
                    </small>
                  </span>
                  <ChevronRight size={12} />
                </Link>
              ))}
              {!risks.length && (
                <p className="luminous-clear">当前没有待处理事项</p>
              )}
            </section>
            <section>
              <h2>
                <CalendarClock size={14} />
                到期提醒 <b>{expiring.length}</b>
              </h2>
              {expiring.slice(0, 3).map((risk) => (
                <Link
                  key={risk.uuid}
                  to={
                    "/instance/" +
                    encodeURIComponent(risk.uuid) +
                    "?focus=expiry"
                  }
                >
                  <span>
                    <strong>{risk.name}</strong>
                    <small>{risk.detail}</small>
                  </span>
                  <ChevronRight size={12} />
                </Link>
              ))}
              {!expiring.length && (
                <p className="luminous-clear">近期没有到期事项</p>
              )}
              <button
                data-home-overview-trigger
                onClick={() => onOpenMetric("expiry")}
              >
                查看全部续费信息 <ChevronRight size={12} />
              </button>
            </section>
          </aside>
        </section>
      )}
      <section
        className="luminous-toolbar luminous-glass"
        aria-label="光域未来节点工具栏"
      >
        <div className="luminous-status-filters">
          {(
            [
              { value: "all", label: "全部", count: nodes.length },
              { value: "online", label: "在线", count: online },
              { value: "attention", label: "关注", count: attention },
            ] as const
          ).map((item) => (
            <button
              key={item.value}
              onClick={() => onStatus(item.value)}
              aria-pressed={status === item.value}
            >
              {item.label}
              <b>{item.count}</b>
            </button>
          ))}
        </div>
        <div className="luminous-filter-controls">
          <label>
            地区
            <select
              aria-label="光域未来地区筛选"
              value={region}
              onChange={(e) => onRegion(e.target.value)}
            >
              <option value="">全部地区</option>
              {regions.map(([code, count]) => (
                <option key={code} value={code}>
                  {regionLabel(code)} ({count})
                </option>
              ))}
            </select>
          </label>
          <label>
            分组
            <select
              aria-label="光域未来分组筛选"
              value={group}
              onChange={(e) => onGroup(e.target.value)}
            >
              <option value="">全部分组</option>
              {groups.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <button
            className="luminous-tools-toggle"
            aria-expanded={toolsOpen}
            onClick={onToggleTools}
          >
            <Settings2 size={15} />
            更多筛选
          </button>
        </div>
        <div className="luminous-view-switch" aria-label="节点视图">
          {views.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              aria-label={label}
              title={label}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              <Icon size={17} />
              <span>{label.replace("卡片", "")}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
