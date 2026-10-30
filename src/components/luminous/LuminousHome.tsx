import {
  useEffect,
  useMemo,
  useRef,
  type ComponentProps,
  type CSSProperties,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Grid2X2,
  List,
  Search,
  ShieldAlert,
  Star,
  Wallet,
} from "lucide-react";
import type OrbitalHome from "@/components/orbital/OrbitalHome";
import { useViewMode } from "@/hooks/useViewMode";
import { useLuminousFavorites } from "@/hooks/useLuminousFavorites";
import { Flag } from "@/components/ui/Flag";
import { FleetThroughput } from "@/components/workspace/FleetThroughput";
import { getDisplayRegionCode } from "@/utils/geo";
import { formatByteRateLabel, formatBytes } from "@/utils/format";
import { formatCnyMoney } from "@/utils/cost";
import { regionLabel } from "@/components/glacier/regionLabel";
import type { WorkbenchSortKey } from "@/utils/vpsWorkbench";
import LuminousScene from "./LuminousScene";
const views = [
  { value: "standard", label: "标准卡片" },
  { value: "compact", label: "紧凑卡片" },
  { value: "large", label: "大卡片" },
  { value: "list", label: "列表" },
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
    facets,
    selectedFacets,
    onFacet,
    sortKey,
    onSort,
  } = props;
  const { mode, setMode } = useViewMode();
  const favorites = useLuminousFavorites();
  const [params] = useSearchParams();
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const groupRequest = useRef(false);
  useEffect(() => {
    if (params.get("filters") === "groups" && !groupRequest.current) {
      groupRequest.current = true;
      if (!toolsOpen) onToggleTools();
    } else if (params.get("filters") !== "groups") groupRequest.current = false;
  }, [params, toolsOpen, onToggleTools]);
  const online = summaries.filter((n) => n.online === true).length;
  const offline = summaries.filter((n) => n.online === false).length;
  const attention = new Set(risks.map((r) => r.uuid)).size;
  const ratio = nodes.length ? (online / nodes.length) * 100 : 0;
  const up = summaries.reduce((sum, n) => sum + n.netUp, 0),
    down = summaries.reduce((sum, n) => sum + n.netDown, 0);
  const totalUp = summaries.reduce((sum, n) => sum + n.trafficUp, 0),
    totalDown = summaries.reduce((sum, n) => sum + n.trafficDown, 0);
  const regions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of nodes) {
      const code = getDisplayRegionCode(n.region);
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [nodes]);
  const groups = [...new Set(nodes.map((n) => n.group).filter(Boolean))];
  const expiring = nodes
    .filter((n) => n.expireDays != null && n.expireDays <= 30)
    .sort((a, b) => (a.expireDays ?? Infinity) - (b.expireDays ?? Infinity));
  return (
    <>
      <header className="luminous-home-heading">
        <label className="luminous-search">
          <Search size={17} />
          <input
            ref={searchInput}
            aria-label="搜索 VPS"
            type="search"
            placeholder="搜索 VPS、名称、IP、标签…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
          <kbd>⌘ K</kbd>
        </label>
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
                  {online}
                  <em>/ {nodes.length}</em>
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
                data-region={code}
                aria-pressed={region === code}
                onClick={() => onRegion(region === code ? "" : code)}
                title={
                  (code === "UN" ? "未设置地区" : regionLabel(code)) +
                  " · " +
                  count +
                  " 个节点"
                }
              >
                <Flag region={code} size={16} />
                {code}
                <b>{count}</b>
              </button>
            ))}
          </div>
          <div className="luminous-hero-right">
            <button
              className="luminous-glass luminous-total"
              data-home-overview-trigger
              title="累计流量：来自节点已上报的上下行计数"
              onClick={() => onOpenMetric("traffic")}
            >
              <small>累计流量</small>
              <strong>{formatBytes(totalUp + totalDown)}</strong>
              <span className="luminous-mini-bars" aria-hidden="true">
                {[2, 4, 3, 6, 5, 8, 10].map((height, i) => (
                  <i
                    key={i}
                    style={
                      { height: height * 5 + "px", "--i": i } as CSSProperties
                    }
                  />
                ))}
              </span>
              <p>
                <span>
                  <ArrowUp size={12} />
                  {formatBytes(totalUp)}
                </span>
                <span>
                  <ArrowDown size={12} />
                  {formatBytes(totalDown)}
                </span>
              </p>
              <span className="luminous-today-note" title={todayTraffic.detail}>
                今日 {todayTraffic.label}
              </span>
            </button>
            {showCost && (
              <button
                className="luminous-glass luminous-assets"
                aria-label="资产统计"
                title="剩余资产估值；下方曲线为场景装饰，点击查看真实资产明细"
                onClick={onOpenCost}
              >
                <small>
                  总资产 *<Wallet size={13} />
                </small>
                <strong>
                  {costSummary
                    ? formatCnyMoney(costSummary.remainingCny)
                    : costLoading
                      ? "计算中"
                      : "—"}
                </strong>
                <svg
                  className="luminous-asset-decor"
                  viewBox="0 0 230 34"
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient id="luminous-asset-fill" x2="0" y2="1">
                      <stop stopColor="#ff6783" stopOpacity=".23" />
                      <stop offset="1" stopColor="#ff6783" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M0 27 C15 5 25 6 40 13S63 31 79 18 102 8 119 20 140 27 157 12 176 25 192 14 213 17 230 0V34H0Z"
                    fill="url(#luminous-asset-fill)"
                  />
                  <path
                    d="M0 27 C15 5 25 6 40 13S63 31 79 18 102 8 119 20 140 27 157 12 176 25 192 14 213 17 230 0"
                    stroke="#ff5b78"
                    fill="none"
                    strokeWidth="1.6"
                  />
                </svg>
                <p>
                  <span>{expiring.length} 台即将到期</span>
                  <span>{attention} 个关注节点</span>
                </p>
                <span className="luminous-assets-explainer">
                  * 剩余资产估值 · 装饰曲线
                </span>
              </button>
            )}
          </div>
          <aside
            className="luminous-glass luminous-notices"
            id="luminous-attention"
          >
            <section>
              <h2>
                当前告警<b>{attention}</b>
              </h2>
              {risks.slice(0, 3).map((risk, i) => (
                <Link
                  key={risk.uuid + "-" + i}
                  to={
                    "/instance/" +
                    risk.uuid +
                    "?focus=" +
                    (risk.evidenceTarget ?? "status")
                  }
                >
                  <i data-tone={risk.severity} />
                  <strong title={risk.name}>{risk.name}</strong>
                  <small title={risk.detail}>{risk.title}</small>
                </Link>
              ))}
              {!risks.length && <p>当前没有待处理事项</p>}
            </section>
            <section>
              <h2>
                即将到期<b>{expiring.length}</b>
              </h2>
              {expiring.slice(0, 3).map((node) => (
                <Link
                  key={node.uuid}
                  to={"/instance/" + node.uuid + "?focus=expiry"}
                >
                  <span className="luminous-notice-avatar" aria-hidden="true">
                    ◉
                  </span>
                  <strong title={node.name}>{node.name}</strong>
                  <small>
                    {(node.expireDays ?? 0) < 0
                      ? "已过期"
                      : node.expireDays + " 天后"}
                  </small>
                </Link>
              ))}
              {!expiring.length && <p>近期没有到期事项</p>}
              <button
                data-home-overview-trigger
                onClick={() => onOpenMetric("expiry")}
                aria-label="查看全部到期节点"
              >
                <ChevronRight size={12} />
              </button>
            </section>
          </aside>
        </section>
      )}
      <section className="luminous-toolbar" aria-label="光域未来节点工具栏">
        <div className="luminous-status-filters luminous-glass">
          {(
            [
              {
                value: "all",
                label: "全部",
                count: nodes.length,
                icon: Activity,
              },
              {
                value: "online",
                label: "在线",
                count: online,
                icon: BoxesIcon,
              },
              {
                value: "offline",
                label: "离线",
                count: offline,
                icon: ShieldAlert,
              },
              {
                value: "attention",
                label: "异常",
                count: attention,
                icon: ShieldAlert,
              },
              {
                value: "favorites",
                label: "收藏",
                count: nodes.filter((n) => favorites.includes(n.uuid)).length,
                icon: Star,
              },
            ] as const
          ).map(({ value, label, count, icon: Icon }) => (
            <button
              key={value}
              aria-pressed={status === value}
              onClick={() => onStatus(value)}
            >
              {value !== "all" && <Icon size={13} />}
              <span>{label}</span>
              <b>{count}</b>
            </button>
          ))}
        </div>
        <div className="luminous-filter-controls luminous-glass">
          <button
            className="luminous-toolbar-search"
            aria-label="聚焦节点搜索"
            onClick={() => searchInput.current?.focus()}
          >
            <Search size={16} />
          </button>
          <label>
            <select
              aria-label="光域未来分组筛选"
              value={group}
              onChange={(e) => onGroup(e.target.value)}
            >
              <option value="">分组</option>
              {groups.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            <select
              aria-label="光域未来地区筛选"
              value={region}
              onChange={(e) => onRegion(e.target.value)}
            >
              <option value="">地区</option>
              {regions.map(([code, count]) => (
                <option key={code} value={code}>
                  {code === "UN" ? "未设置地区" : regionLabel(code)} ({count})
                </option>
              ))}
            </select>
          </label>
          {["purpose", "provider", "line"].map((id) => {
            const facet = facets?.find((row) => row.dimension.id === id);
            return (
              <label key={id}>
                <select
                  aria-label={
                    "光域未来" + (facet?.dimension.label ?? id) + "筛选"
                  }
                  value={selectedFacets?.[id]?.[0] ?? ""}
                  onChange={(e) => onFacet?.(id, e.target.value)}
                >
                  <option value="">
                    {facet?.dimension.label ??
                      { purpose: "用途", provider: "厂商", line: "线路" }[id]}
                  </option>
                  {facet?.options.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
            );
          })}
          <label className="luminous-toolbar-sort">
            <select
              aria-label="节点排序"
              value={sortKey ?? "weight"}
              onChange={(e) => onSort?.(e.target.value as WorkbenchSortKey)}
            >
              {[
                { value: "weight", label: "默认排序" },
                { value: "risk", label: "异常优先" },
                { value: "expiry", label: "到期时间" },
                { value: "bandwidth", label: "实时带宽" },
                { value: "name", label: "节点名称" },
              ].map((item) => (
                <option key={item.value} value={item.value}>
                  排序: {item.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="luminous-tools-toggle"
            aria-label="更多筛选与工具"
            aria-expanded={toolsOpen}
            onClick={onToggleTools}
          >
            <ChevronDown size={16} />
          </button>
        </div>
        <div
          className="luminous-view-switch luminous-glass"
          aria-label="节点视图"
        >
          <button
            className="luminous-grid-view"
            aria-label="标准卡片"
            aria-pressed={mode !== "list"}
            onClick={() => setMode("standard")}
          >
            <Grid2X2 size={17} />
          </button>
          <label>
            <Grid2X2 size={14} />
            <select
              aria-label="选择节点视图"
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              {views.map((view) => (
                <option key={view.value} value={view.value}>
                  {view.label}
                </option>
              ))}
            </select>
          </label>
          <button
            aria-label="列表"
            aria-pressed={mode === "list"}
            onClick={() => setMode("list")}
          >
            <List size={17} />
          </button>
        </div>
      </section>
    </>
  );
}
function BoxesIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="m8 1 6 3.5v7L8 15l-6-3.5v-7Z" fill="#08cd96" />
      <path
        d="m4.5 8 2.2 2.2L11.7 5"
        fill="none"
        stroke="white"
        strokeWidth="1.5"
      />
    </svg>
  );
}
