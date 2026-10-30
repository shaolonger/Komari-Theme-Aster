import { useMemo, type ComponentProps } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowDownUp,
  ChevronRight,
  Cloud,
  LayoutGrid,
  List,
  Rows3,
  Search,
  Settings2,
  Wallet,
} from "lucide-react";
import type GlacierHome from "@/components/glacier/GlacierHome";
import { FleetThroughput } from "@/components/workspace/FleetThroughput";
import { useViewMode } from "@/hooks/useViewMode";
import { formatByteRateLabel } from "@/utils/format";
import { formatCnyMoney } from "@/utils/cost";
import { getDisplayRegionCode } from "@/utils/geo";
import { regionLabel } from "@/components/glacier/regionLabel";
import type { CSSProperties } from "react";

type Props = ComponentProps<typeof GlacierHome> & {
  region: string;
  onRegion: (value: string) => void;
  group: string;
  onGroup: (value: string) => void;
  facets?: { dimension: {id:string;label:string}; options:string[] }[];
  selectedFacets?: Record<string,string[]>;
  onFacet?: (dimension:string,value:string)=>void;
  sortKey?: import("@/utils/vpsWorkbench").WorkbenchSortKey;
  onSort?: (value:import("@/utils/vpsWorkbench").WorkbenchSortKey)=>void;
};
const views = [
  { value: "list", label: "列表", icon: List },
  { value: "standard", label: "标准卡片", icon: LayoutGrid },
  { value: "compact", label: "紧凑卡片", icon: Rows3 },
  { value: "large", label: "大卡片", icon: LayoutGrid },
] as const;

export default function OrbitalHome(props: Props) {
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
  const compact = mode === "compact";
  const online = summaries.filter((n) => n.online === true).length;
  const offline = summaries.filter((n) => n.online === false).length;
  const attention = new Set(risks.map((r) => r.uuid)).size;
  const regions = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of nodes) {
      const code = getDisplayRegionCode(n.region);
      map.set(code, (map.get(code) ?? 0) + 1);
    }
    return [...map].sort((a, b) => b[1] - a[1]);
  }, [nodes]);
  const groups = [...new Set(nodes.map((n) => n.group).filter(Boolean))];
  const ratio = nodes.length ? (online / nodes.length) * 100 : 0;
  const bandwidth = formatByteRateLabel(
    summaries.reduce((s, n) => s + n.netUp + n.netDown, 0),
  );
  const metrics = (
    <>
      <button onClick={() => onOpenMetric("status")}>
        <Activity />
        <span>
          <strong>
            {online} / {nodes.length}
          </strong>
          <small>在线节点</small>
        </span>
      </button>
      <button
        onClick={() => onStatus(status === "attention" ? "all" : "attention")}
        data-tone={attention ? "danger" : "success"}
      >
        <AlertTriangle />
        <span>
          <strong>{attention}</strong>
          <small>需关注节点</small>
        </span>
      </button>
      <button onClick={() => onOpenMetric("bandwidth")}>
        <ArrowDownUp />
        <span>
          <strong>{bandwidth}</strong>
          <small>实时网络吞吐</small>
        </span>
      </button>
      <button
        title={todayTraffic.detail}
        onClick={() => onOpenMetric("traffic")}
      >
        <Cloud />
        <span>
          <strong>{todayTraffic.label}</strong>
          <small>今日流量</small>
        </span>
      </button>
    </>
  );
  return (
    <>
      <header className="orbital-home-heading" data-compact={compact}>
        <div>
          <h1>
            {compact ? "节点矩阵" : "全局态势"}
            {!compact && (
              <span className="orbital-live">
                <i />
                LIVE
              </span>
            )}
          </h1>
          {compact && (
            <p>全球 {nodes.length} 个 VPS 节点 · 实时状态与性能监控</p>
          )}
        </div>
        {compact && showOverview ? (
          <div className="orbital-matrix-metrics">{metrics}</div>
        ) : (
          <span className="orbital-heading-status">
            <i />
            实时状态自动同步
          </span>
        )}
      </header>
      {showOverview && !compact && (
        <section
          className="orbital-fleet orbital-panel"
          aria-label="全网运行状态"
        >
          <div className="orbital-fleet-health">
            <button
              className="orbital-online-ring"
              style={{ "--ring-fill": `${ratio}%` } as CSSProperties}
              onClick={() => onOpenMetric("status")}
            >
              <span>
                <strong>
                  {online} / {nodes.length}
                </strong>
                <small>在线</small>
              </span>
            </button>
            <dl>
              <div>
                <dt>
                  <i />
                  在线节点
                </dt>
                <dd>{online}</dd>
              </div>
              <div>
                <dt>
                  <i className="is-error" />
                  需关注节点
                </dt>
                <dd className="orbital-error">{attention}</dd>
              </div>
              <div>
                <dt>
                  <i className="is-muted" />
                  离线节点
                </dt>
                <dd>{offline}</dd>
              </div>
              <div>
                <dt>在线率</dt>
                <dd>{ratio.toFixed(1)}%</dd>
              </div>
            </dl>
          </div>
          <RegionMap regions={regions} />
          <div className="orbital-fleet-stats">
            <button onClick={() => onOpenMetric("bandwidth")}>
              <ArrowDownUp />
              <span>
                <strong>{bandwidth}</strong>
                <small>实时网络吞吐</small>
              </span>
            </button>
            <button
              onClick={() => onOpenMetric("traffic")}
              title={todayTraffic.detail}
            >
              <Cloud />
              <span>
                <strong>{todayTraffic.label}</strong>
                <small>今日流量</small>
              </span>
            </button>
            {showCost && (
              <button aria-label="资产统计" onClick={onOpenCost}>
                <Wallet />
                <span>
                  <strong>
                    {costSummary
                      ? formatCnyMoney(costSummary.remainingCny)
                      : costLoading
                        ? "计算中"
                        : "—"}
                  </strong>
                  <small>剩余资产</small>
                </span>
              </button>
            )}
            <button
              onClick={() =>
                onStatus(status === "attention" ? "all" : "attention")
              }
            >
              <AlertTriangle />
              <span>
                <strong className="orbital-error">{attention}</strong>
                <small>需关注节点</small>
              </span>
            </button>
          </div>
          <div className="orbital-fleet-history">
            <h2>近 24 小时吞吐</h2>
            <FleetThroughput summaries={summaries} />
          </div>
        </section>
      )}
      {risks.length > 0 && (
        <div className="orbital-alert-strip">
          <AlertTriangle size={20} />
          <Link
            to={`/instance/${encodeURIComponent(risks[0].uuid)}?focus=${risks[0].evidenceTarget ?? "status"}`}
          >
            <strong>
              {risks[0].title} · {risks[0].name}
            </strong>
            <span>{risks[0].detail}</span>
            <ChevronRight size={18} />
          </Link>
          <button
            onClick={() =>
              onStatus(status === "attention" ? "all" : "attention")
            }
            aria-pressed={status === "attention"}
          >
            查看 {attention} 台关注节点
          </button>
        </div>
      )}
      <section className="orbital-toolbar" aria-label="星轨节点工具栏">
        <label className="orbital-search">
          <Search size={18} />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="搜索节点名称、IP 或备注…"
            aria-label="搜索 VPS"
          />
        </label>
        <div className="orbital-status-filters">
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
              <strong>{item.count}</strong>
            </button>
          ))}
        </div>
        <label className="orbital-select">
          地区
          <select
            value={region}
            onChange={(e) => onRegion(e.target.value)}
            aria-label="星轨地区筛选"
          >
            <option value="">全部地区</option>
            {regions.map(([code, count]) => (
              <option key={code} value={code}>
                {code === "UN" ? "未设置地区" : regionLabel(code)} ({count})
              </option>
            ))}
          </select>
        </label>
        <label className="orbital-select">
          分组
          <select
            value={group}
            onChange={(e) => onGroup(e.target.value)}
            aria-label="星轨分组筛选"
          >
            <option value="">全部分组</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <button
          className="orbital-tools-toggle"
          onClick={onToggleTools}
          aria-expanded={toolsOpen}
          title="排序、分类、指定节点与对比"
        >
          <Settings2 size={17} />
          <span>更多筛选</span>
        </button>
        <div
          className="orbital-view-switch"
          role="group"
          aria-label="星轨节点视图"
        >
          {views.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
              aria-label={label}
            >
              <Icon size={17} />
              <span>{label.replace("卡片", "")}</span>
            </button>
          ))}
        </div>
      </section>
      {compact && (
        <div
          className="orbital-region-tabs"
          role="group"
          aria-label="地区快捷筛选"
        >
          <button aria-pressed={!region} onClick={() => onRegion("")}>
            全部 ({nodes.length})
          </button>
          {regions.map(([code, count]) => (
            <button
              key={code}
              aria-pressed={region === code}
              onClick={() => onRegion(code)}
            >
              {code === "UN" ? "未设置地区" : regionLabel(code)} ({count})
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function RegionMap({ regions }: { regions: [string, number][] }) {
  const buckets = [
    { label: "北美", x: 85, y: 90, codes: new Set(["US", "CA", "MX"]) },
    {
      label: "欧洲",
      x: 275,
      y: 90,
      codes: new Set([
        "DE",
        "GB",
        "FR",
        "NL",
        "IT",
        "ES",
        "SE",
        "FI",
        "PL",
        "CH",
        "AT",
        "IE",
        "NO",
        "DK",
        "PT",
        "BE",
        "CZ",
        "RO",
        "UA",
        "RU",
      ]),
    },
    {
      label: "亚洲",
      x: 460,
      y: 100,
      codes: new Set([
        "CN",
        "HK",
        "JP",
        "SG",
        "TW",
        "KR",
        "IN",
        "MY",
        "TH",
        "ID",
        "VN",
        "PH",
        "MO",
        "IL",
        "TR",
        "AE",
      ]),
    },
    { label: "其他", x: 480, y: 200, codes: new Set<string>() },
  ];
  const counts = buckets.map(() => 0);
  for (const [code, count] of regions) {
    const i = buckets.findIndex((b) => b.codes.has(code));
    counts[i < 0 ? 3 : i] += count;
  }
  return (
    <div className="orbital-region-map">
      <svg
        viewBox="0 0 600 265"
        role="img"
        aria-label={buckets
          .map((b, i) => `${b.label} ${counts[i]} 台`)
          .join("，")}
      >
        <defs>
          <pattern
            id="orbital-land-dots"
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="2" cy="2" r="1" fill="#125283" />
          </pattern>
          <radialGradient id="orbital-map-point">
            <stop stopColor="#78f6ff" />
            <stop offset=".4" stopColor="#15cce9" />
            <stop offset="1" stopColor="#17447c" stopOpacity=".1" />
          </radialGradient>
        </defs>
        <g fill="url(#orbital-land-dots)">
          <path d="M36 40 67 22 127 26 151 43 180 50 168 76 143 82 128 112 102 123 82 98 58 95 49 67Z M138 129 165 133 187 156 181 189 163 221 149 230 143 195 126 170Z M255 53 273 36 310 40 330 23 391 29 410 42 476 42 548 73 566 96 536 119 504 115 480 150 451 153 421 123 398 119 374 98 347 108 321 89 302 85 277 91 254 75Z M281 100 320 99 342 127 337 157 316 194 294 179 280 145 269 121Z M471 182 502 171 537 184 545 210 506 218 481 208Z M190 24 225 19 232 43 212 61 195 48Z" />
        </g>
        <g
          fill="none"
          stroke="#1a4e87"
          strokeWidth=".8"
          opacity=".8"
          aria-hidden="true"
        >
          <ellipse cx="307" cy="145" rx="251" ry="86" />
          <path d="M60 189Q270 -80 535 190M93 225Q330 24 550 202" />
        </g>
        {buckets.map((b, i) => (
          <g key={b.label}>
            <circle cx={b.x} cy={b.y} r="26" fill="url(#orbital-map-point)" />
            <circle
              cx={b.x}
              cy={b.y}
              r="12"
              fill="#0e72ad66"
              stroke="#2bdff2"
            />
            <circle cx={b.x} cy={b.y} r="4" fill="#9afff4" />
            <text x={b.x - 18} y={b.y + 40} fill="#cde8ff" fontSize="15">
              {b.label} {counts[i]}
            </text>
          </g>
        ))}
      </svg>
      <small>节点地区分布 · 区域示意</small>
    </div>
  );
}
