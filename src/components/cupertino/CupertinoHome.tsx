import {
  useMemo,
  useRef,
  type ComponentProps,
  type CSSProperties,
} from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ChevronRight,
  LayoutGrid,
  List,
  Rows3,
  Server,
  Settings2,
  Star,
  Wallet,
} from "lucide-react";
import type OrbitalHome from "@/components/orbital/OrbitalHome";
import { useViewMode } from "@/hooks/useViewMode";
import { useLuminousFavorites } from "@/hooks/useLuminousFavorites";
import LuminousSearch from "@/components/luminous/LuminousSearch";
import { FleetThroughput } from "@/components/workspace/FleetThroughput";
import { getDisplayRegionCode } from "@/utils/geo";
import { regionLabel } from "@/components/glacier/regionLabel";
import { formatByteRateLabel } from "@/utils/format";
import { formatCnyMoney } from "@/utils/cost";
import type { WorkbenchSortKey } from "@/utils/vpsWorkbench";

export default function CupertinoHome(p: ComponentProps<typeof OrbitalHome>) {
  const { mode, setMode } = useViewMode(),
    favorites = useLuminousFavorites();
  const input = useRef<HTMLInputElement>(null);
  const online = p.summaries.filter((n) => n.online === true).length,
    offline = p.summaries.filter((n) => n.online === false).length;
  const attention = new Set(p.risks.map((r) => r.uuid)).size,
    expiring = p.nodes.filter(
      (n) => n.expireDays != null && n.expireDays <= 30,
    ).length;
  const ratio = p.nodes.length ? (online / p.nodes.length) * 100 : 0;
  const up = p.summaries.reduce(
      (s, n) => s + (n.online === true ? n.netUp : 0),
      0,
    ),
    down = p.summaries.reduce(
      (s, n) => s + (n.online === true ? n.netDown : 0),
      0,
    );
  const regions = useMemo(() => {
    const map = new Map<string, number>();
    for (const node of p.nodes) {
      const code = getDisplayRegionCode(node.region);
      map.set(code, (map.get(code) || 0) + 1);
    }
    return [...map].sort((a, b) => b[1] - a[1]);
  }, [p.nodes]);
  const groups = [...new Set(p.nodes.map((n) => n.group).filter(Boolean))];
  const statuses = [
    ["all", "全部", p.nodes.length],
    ["online", "在线", online],
    ["offline", "离线", offline],
    ["attention", "关注", attention],
    [
      "favorites",
      "收藏",
      p.nodes.filter((n) => favorites.includes(n.uuid)).length,
    ],
  ] as const;
  return (
    <div className="cupertino-home">
      <div className="cupertino-home-search">
        <LuminousSearch
          value={p.search}
          onChange={p.onSearch}
          texts={p.searchTexts}
          resultCount={p.searchResultCount}
          hasFilters={p.searchHasFilters}
          inputRef={input}
        />
      </div>
      <header className="cupertino-home-heading">
        <h1>节点总览</h1>
        <p>
          所有节点，一目了然。
          <span>
            <i />
            实时更新
          </span>
        </p>
      </header>
      {p.showOverview && (
        <section
          className="cupertino-overview"
          aria-label="全网运行状态"
          data-cost={p.showCost}
        >
          <button
            className="cupertino-overview-card cupertino-online"
            onClick={() => p.onOpenMetric("status")}
            data-home-overview-trigger="status"
          >
            <span className="cupertino-stat-icon">
              <Server />
            </span>
            <span className="cupertino-stat-content">
              <span>在线节点</span>
              <strong>
                {online}
                <small>/ {p.nodes.length}</small>
              </strong>
              <em>{ratio.toFixed(1)}% 在线率</em>
            </span>
            <span
              className="cupertino-fleet-ring"
              style={{ "--ratio": ratio + "%" } as CSSProperties}
            >
              <b>{ratio.toFixed(1)}%</b>
            </span>
          </button>
          <section className="cupertino-overview-card cupertino-bandwidth">
            <button
              onClick={() => p.onOpenMetric("bandwidth")}
              data-home-overview-trigger="bandwidth"
            >
              <span className="cupertino-stat-icon">
                <Activity />
              </span>
              <span className="cupertino-stat-content">
                <span>实时带宽</span>
                <strong>{formatByteRateLabel(up + down)}</strong>
              </span>
            </button>
            <FleetThroughput summaries={p.summaries} />
            <p>
              <span>
                <ArrowDown />
                {formatByteRateLabel(down)}
              </span>
              <span>
                <ArrowUp />
                {formatByteRateLabel(up)}
              </span>
            </p>
          </section>
          <button
            className="cupertino-overview-card cupertino-daily"
            title={p.todayTraffic.detail}
            onClick={() => p.onOpenMetric("traffic")}
            data-home-overview-trigger="traffic"
          >
            <span className="cupertino-stat-icon">
              <LayoutGrid />
            </span>
            <span className="cupertino-stat-content">
              <span>今日流量</span>
              <strong>{p.todayTraffic.label}</strong>
              <small>已观测用量</small>
            </span>
            <BarMark />
          </button>
          {p.showCost && (
            <button
              className="cupertino-overview-card cupertino-assets"
              onClick={p.onOpenCost}
              title="剩余资产估值；点击查看资产与续费明细"
            >
              <span className="cupertino-stat-icon">
                <Wallet />
              </span>
              <span className="cupertino-stat-content">
                <span>资产与续费</span>
                <strong>
                  {p.costSummary
                    ? formatCnyMoney(p.costSummary.remainingCny)
                    : p.costLoading
                      ? "计算中"
                      : "—"}
                </strong>
                <em>{expiring} 台即将到期</em>
              </span>
              <CalendarDays className="cupertino-assets-calendar" />
            </button>
          )}
        </section>
      )}
      <button
        className="cupertino-attention"
        data-clear={!offline && !attention}
        onClick={() => p.onStatus(offline || attention ? "attention" : "all")}
      >
        <AlertTriangle size={18} />
        <strong>
          {offline || attention
            ? `${offline} 个节点离线 · ${attention} 个节点需要关注`
            : "所有节点暂无待处理事项"}
        </strong>
        <span>
          查看详情 <ChevronRight size={15} />
        </span>
      </button>
      <section className="cupertino-toolbar" aria-label="节点筛选与视图">
        <div className="cupertino-status-filters">
          {statuses.map(([value, label, count]) => (
            <button
              key={value}
              aria-pressed={p.status === value}
              onClick={() => p.onStatus(value)}
            >
              {value === "favorites" ? (
                <Star size={14} />
              ) : value !== "all" ? (
                <i data-status={value} />
              ) : null}
              {label}
              <b>{count}</b>
            </button>
          ))}
        </div>
        <div className="cupertino-filters">
          <select
            aria-label="原生主题地区筛选"
            value={p.region}
            onChange={(e) => p.onRegion(e.target.value)}
          >
            <option value="">地区</option>
            {regions.map(([code, count]) => (
              <option key={code} value={code}>
                {regionLabel(code)} ({count})
              </option>
            ))}
          </select>
          <select
            aria-label="原生主题分组筛选"
            value={p.group}
            onChange={(e) => p.onGroup(e.target.value)}
          >
            <option value="">分组</option>
            {groups.map((group) => (
              <option key={group}>{group}</option>
            ))}
          </select>
          <select
            aria-label="节点排序"
            value={p.sortKey}
            onChange={(e) => p.onSort?.(e.target.value as WorkbenchSortKey)}
          >
            <option value="weight">排序：默认</option>
            <option value="risk">关注优先</option>
            <option value="expiry">到期时间</option>
            <option value="bandwidth">实时带宽</option>
            <option value="name">节点名称</option>
          </select>
          <button
            className="cupertino-more-filters"
            aria-label="更多筛选与工具"
            aria-expanded={p.toolsOpen}
            onClick={p.onToggleTools}
          >
            <Settings2 size={15} />
          </button>
        </div>
        <div
          className="cupertino-view-switch"
          role="group"
          aria-label="节点视图"
        >
          {(
            [
              { value: "list", label: "列表", icon: List },
              { value: "standard", label: "标准", icon: LayoutGrid },
              { value: "compact", label: "紧凑", icon: Rows3 },
              { value: "large", label: "大卡片", icon: LayoutGrid },
            ] as const
          ).map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      </section>
      {p.toolsOpen && (
        <div className="cupertino-extra-filters">
          {p.facets?.map(({ dimension, options }) => (
            <label key={dimension.id}>
              {dimension.label}
              <select
                aria-label={"原生主题" + dimension.label + "筛选"}
                value={p.selectedFacets?.[dimension.id]?.[0] || ""}
                onChange={(e) => p.onFacet?.(dimension.id, e.target.value)}
              >
                <option value="">不限</option>
                {options.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
function BarMark() {
  return (
    <span
      className="cupertino-daily-mark"
      aria-hidden="true"
      title="用量装饰图形"
    >
      {[0.35, 0.7, 0.6, 0.46, 0.68, 1, 0.82].map((v, i) => (
        <i key={i} style={{ height: v * 48 }} />
      ))}
    </span>
  );
}
