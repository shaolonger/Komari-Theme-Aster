import { FleetThroughput } from "@/components/workspace/FleetThroughput";
import { regionLabel } from "./regionLabel";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ChevronRight,
  Cloud,
  LayoutGrid,
  List,
  RefreshCw,
  Rows3,
  Search,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";
import { useViewMode } from "@/hooks/useViewMode";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { formatByteRateLabel } from "@/utils/format";
import { formatCnyMoney } from "@/utils/cost";
import { getDisplayRegionCode } from "@/utils/geo";
import { Flag } from "@/components/ui/Flag";
import type { VpsWorkbenchNode } from "@/utils/vpsWorkbench";
import type { VpsRisk } from "@/utils/vpsRisk";
import type { HomeNodeSummary } from "@/services/wsStore";
import { formatDisplayDateTime } from "@/utils/timeDisplay";

export type GlacierStatus = "all" | "online" | "attention";
const views = [
  { value: "list", label: "列表", icon: List },
  { value: "compact", label: "紧凑卡片", icon: Rows3 },
  { value: "standard", label: "标准卡片", icon: LayoutGrid },
  { value: "large", label: "大卡片", icon: LayoutGrid },
] as const;

export default function GlacierHome({
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
}: {
  nodes: VpsWorkbenchNode[];
  summaries: HomeNodeSummary[];
  risks: (VpsRisk & { name: string })[];
  search: string;
  onSearch: (value: string) => void;
  toolsOpen: boolean;
  onToggleTools: () => void;
  status: GlacierStatus;
  onStatus: (value: GlacierStatus) => void;
  todayTraffic: { label: string; detail: string };
  costSummary: { remainingCny: number } | null;
  costLoading: boolean;
  onOpenMetric: (metric: "status" | "bandwidth" | "traffic" | "expiry") => void;
  onOpenCost: () => void;
  showOverview: boolean;
  showCost: boolean;
}) {
  const { mode, setMode } = useViewMode();
  const settings = useThemeSettings();
  const [allRisks, setAllRisks] = useState(false);
  const regions = useMemo(() => {
    const grouped = new Map<
      string,
      { region: string; online: number; offline: number; pending: number }
    >();
    for (const node of nodes) {
      const code = getDisplayRegionCode(node.region || "");
      const row = grouped.get(code) ?? {
        region: node.region || "未设置地区",
        online: 0,
        offline: 0,
        pending: 0,
      };
      if (node.online === true) row.online++;
      else if (node.online === false) row.offline++;
      else row.pending++;
      grouped.set(code, row);
    }
    return [...grouped.values()].sort(
      (a, b) =>
        b.online + b.offline + b.pending - a.online - a.offline - a.pending,
    );
  }, [nodes]);
  const online = summaries.filter((n) => n.online === true).length;
  const attention = new Set(risks.map((r) => r.uuid)).size;
  const percent = nodes.length ? (online / nodes.length) * 100 : 0;
  const latest = Math.max(0, ...summaries.map((n) => n.updatedAt));
  return (
    <>
      <header className="glacier-home-header">
        <div>
          <h1>基础设施</h1>
          <p>实时掌握所有节点的运行状态</p>
        </div>
        <label className="glacier-search">
          <Search size={18} />
          <input
            type="search"
            aria-label="搜索 VPS"
            placeholder="搜索节点、IP 或备注…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </label>
        <button
          className="glacier-button"
          onClick={onToggleTools}
          aria-expanded={toolsOpen}
        >
          <SlidersHorizontal size={17} />
          筛选与视图
        </button>
        <button
          className="glacier-button"
          onClick={() => window.location.reload()}
        >
          <RefreshCw size={17} />
          刷新
        </button>
      </header>
      {showOverview && (
        <section
          className="glacier-overview glacier-panel"
          aria-label="全网运行状态"
        >
          <div className="glacier-online-summary">
            <h2>全网运行状态</h2>
            <button
              className="glacier-online-value"
              onClick={() => onOpenMetric("status")}
            >
              <strong>{online}</strong>
              <span>/ {nodes.length} 台在线</span>
            </button>
            <div className="glacier-online-bar">
              <progress max={100} value={percent} />
              <strong>{percent.toFixed(1)}%</strong>
            </div>
            <button
              className="glacier-attention-pill"
              data-clear={attention === 0}
              onClick={() =>
                onStatus(status === "attention" ? "all" : "attention")
              }
            >
              <AlertCircle size={16} />
              {attention ? `${attention} 台需要关注` : "所有节点运行正常"}
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="glacier-throughput">
            <div className="glacier-throughput-header">
              <button onClick={() => onOpenMetric("bandwidth")}>
                <h2>全网吞吐</h2>
                <strong>
                  {formatByteRateLabel(
                    summaries.reduce((s, n) => s + n.netUp + n.netDown, 0),
                  )}
                </strong>
              </button>
              <div className="glacier-mini-stats">
                <button
                  onClick={() => onOpenMetric("traffic")}
                  title={todayTraffic.detail}
                >
                  <Cloud />
                  <span>
                    今日流量<strong>{todayTraffic.label}</strong>
                  </span>
                </button>
                {showCost && (
                  <button onClick={onOpenCost}>
                    <Wallet />
                    <span>
                      资产
                      <strong>
                        {costSummary
                          ? formatCnyMoney(costSummary.remainingCny)
                          : costLoading ? "计算中" : "—"}
                      </strong>
                    </span>
                  </button>
                )}
              </div>
            </div>
            <FleetThroughput summaries={summaries} />
          </div>
        </section>
      )}
      <div className="glacier-nodes-heading">
        <h2>节点</h2>
        <div className="glacier-segments" aria-label="节点状态筛选">
          {(
            [
              { value: "all", label: "全部", count: nodes.length },
              { value: "online", label: "在线", count: online },
              { value: "attention", label: "关注", count: attention },
            ] as const
          ).map((item) => (
            <button
              key={item.value}
              aria-pressed={status === item.value}
              onClick={() => onStatus(item.value)}
            >
              {item.label} <span>{item.count}</span>
            </button>
          ))}
        </div>
        <div
          className="glacier-view-switch"
          role="group"
          aria-label="冰川节点视图"
        >
          {views.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              aria-label={label}
              title={label}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>
      <aside className="glacier-home-aside">
        <section className="glacier-panel glacier-attention">
          <header>
            <h2>需要处理</h2>
            <button onClick={() => setAllRisks((v) => !v)}>
              {allRisks ? "收起" : "查看全部"}
              <ChevronRight size={14} />
            </button>
          </header>
          {(allRisks ? risks : risks.slice(0, 3)).map((risk, i) => (
            <Link
              key={`${risk.uuid}-${risk.kind}-${i}`}
              to={`/instance/${encodeURIComponent(risk.uuid)}?focus=${risk.evidenceTarget ?? "status"}`}
              className="glacier-risk"
              data-severity={risk.severity}
            >
              <i />
              <div>
                <strong>{risk.name}</strong>
                <small>{risk.detail}</small>
              </div>
              <span>{risk.title}</span>
              <ChevronRight size={15} />
            </Link>
          ))}
          {!risks.length && <p className="glacier-empty">当前没有待处理事项</p>}
        </section>
        <section className="glacier-panel glacier-regions">
          <header>
            <h2>地区健康</h2>
            <small>
              <i className="glacier-status-dot" />
              在线 <i className="glacier-status-dot is-error" />
              离线
            </small>
          </header>
          {regions.map((row) => {
            const total = row.online + row.offline + row.pending;
            return (
              <div key={row.region} className="glacier-region">
                <Flag region={row.region} size={17} />
                <span title={row.region}>{regionLabel(row.region)}</span>
                <div
                  className="glacier-region-bar"
                  title={`在线 ${row.online} · 离线 ${row.offline} · 待上报 ${row.pending}`}
                >
                  <i style={{ width: `${(row.online / total) * 100}%` }} />
                  <i style={{ width: `${(row.offline / total) * 100}%` }} />
                </div>
                <strong>{row.online}</strong>
                <em>{row.offline}</em>
              </div>
            );
          })}
        </section>
      </aside>
      <footer className="glacier-home-footer">
        <span>
          <RefreshCw size={13} />
          实时状态自动同步 · {nodes.length} 台节点
        </span>
        <span>
          最近上报{" "}
          {latest
            ? formatDisplayDateTime(latest, settings.displayTimeZone, {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "等待数据"}
        </span>
      </footer>
    </>
  );
}
