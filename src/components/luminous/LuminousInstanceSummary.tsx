import { useSearchParams } from "react-router-dom";
import type { CSSProperties, ReactNode } from "react";
import {
  CalendarClock,
  Cloud,
  Clock3,
  ChevronDown,
  Cpu,
  Database,
  HardDrive,
  Layers,
  MemoryStick,
  Radio,
} from "lucide-react";
import { useLoadRecords } from "@/hooks/useRecords";
import { usePingMini } from "@/hooks/usePingMini";
import { formatDisplayDateTime } from "@/utils/timeDisplay";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import type { InstanceView } from "@/utils/instanceView";
import {
  formatBytes,
  formatMetricPercent,
  formatUptimeDays,
} from "@/utils/format";
import { formatRenewalPrice } from "@/utils/billing";
import { resolveTrafficUsage } from "@/utils/traffic";
import type { NodeInfo, NodeMetrics } from "@/types/komari";
import type { VpsWorkbenchNode } from "@/utils/vpsWorkbench";
export default function LuminousInstanceSummary({
  node,
  loss,
  workbench,
  view,
  details,
  children,
}: {
  view: InstanceView;
  details: ReactNode;
  children?: ReactNode;
  node: NodeInfo & NodeMetrics;
  loss: number | null | undefined;
  workbench: VpsWorkbenchNode;
}) {
  const { data } = useLoadRecords(node.uuid, 1, view === "load", node);
  const ping = usePingMini(node.uuid);
  const settings = useThemeSettings();
  const [params] = useSearchParams();
  const uptime = formatUptimeDays(node.uptime);
  const created = node.created_at
    ? formatDisplayDateTime(
        Date.parse(node.created_at),
        settings.displayTimeZone,
        { year: "numeric", month: "2-digit", day: "2-digit" },
      )
    : "未记录";
  const rows = data?.records ?? [];
  const metrics = [
    {
      label: "CPU 使用率",
      icon: Cpu,
      value: formatMetricPercent(node.cpuPct),
      suffix: "",
      detail: "",
      color: "#0085ff",
      values: rows.map((r) => r.cpu),
    },
    {
      label: "内存使用",
      icon: MemoryStick,
      value: formatBytes(node.ramUsed),
      suffix: "/ " + formatBytes(node.ramTotal),
      detail: formatMetricPercent(node.ramPct),
      color: "#9b4dff",
      values: rows.map((r) => (r.ram_total ? (r.ram / r.ram_total) * 100 : 0)),
    },
    {
      label: "磁盘使用",
      icon: HardDrive,
      value: formatBytes(node.diskUsed),
      suffix: "/ " + formatBytes(node.diskTotal),
      detail: formatMetricPercent(node.diskPct),
      color: "#ff981a",
      values: rows.map((r) =>
        r.disk_total ? (r.disk / r.disk_total) * 100 : 0,
      ),
    },
    {
      label: "Ping 状态",
      icon: Radio,
      value:
        loss == null
          ? "暂无观测"
          : loss >= 20
            ? "高丢包"
            : loss >= 5
              ? "波动"
              : "正常",
      suffix: "",
      detail:
        loss == null ? "未取得可用样本" : "丢包 " + formatMetricPercent(loss),
      color: loss != null && loss >= 5 ? "#ff4e73" : "#00ba94",
      values: ping.samples.map((sample) =>
        sample.sampleCount
          ? ((sample.lossCount ?? 0) / sample.sampleCount) * 100
          : 0,
      ),
    },
  ];
  const traffic = resolveTrafficUsage(
    node.traffic_limit_type,
    node.trafficUp,
    node.trafficDown,
    node.traffic_limit,
  );
  const percentage = traffic.unlimited
    ? 0
    : Math.min(100, (traffic.used / traffic.limit) * 100);
  return (
    <section className="luminous-instance-content" id="instance-summary">
      {node.online === false && (
        <p className="luminous-node-cache-notice" role="status">
          节点当前离线，资源指标展示最后一次上报的缓存数据；历史图表按所选时间范围展示。
        </p>
      )}
      {view === "load" && (
        <section
          className="orbital-instance-metrics luminous-instance-metrics"
          aria-label="节点实时指标"
        >
          {metrics.map(
            ({ label, icon: Icon, value, suffix, detail, color, values }) => (
              <article
                key={label}
                className="luminous-glass"
                style={{ "--metric-color": color } as CSSProperties}
              >
                <Icon />
                <div>
                  <span>{label}</span>
                  <strong>
                    {value}
                    <small>{suffix}</small>
                  </strong>
                  {detail && <p>{detail}</p>}
                </div>
                <MetricMini values={values} />
              </article>
            ),
          )}
          <article
            className="luminous-glass luminous-runtime-metric"
            data-metric="uptime"
            style={{ "--metric-color": "#0085ff" } as CSSProperties}
          >
            <Clock3 />
            <div>
              <span>运行时长</span>
              <strong>
                {uptime.value} {uptime.unit}
              </strong>
              <p title={"创建时间 · " + created}>创建于 {created}</p>
            </div>
          </article>
        </section>
      )}
      <div
        className="luminous-detail-columns"
        data-sidebar={view === "load" || view === "traffic"}
      >
        <div className="luminous-detail-main">{children}</div>
        {(view === "load" || view === "traffic") && (
          <aside className="luminous-detail-aside">
            <section className="luminous-asset-panel luminous-glass">
              <h2>
                <span>
                  <Database size={19} />
                </span>
                流量与续费
              </h2>
              <div className="luminous-quota-overview">
                <div
                  className="luminous-quota-ring"
                  style={{ "--quota": percentage + "%" } as CSSProperties}
                >
                  <span>
                    <Cloud size={21} />
                    <strong>
                      {traffic.unlimited ? "∞" : percentage.toFixed(2) + "%"}
                    </strong>
                    <small>{traffic.unlimited ? "未设上限" : "已使用"}</small>
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>
                      <i />
                      已用流量
                    </dt>
                    <dd>{formatBytes(traffic.used)}</dd>
                  </div>
                  <div>
                    <dt>
                      <i />
                      总流量
                    </dt>
                    <dd>
                      {traffic.unlimited ? "不限" : formatBytes(traffic.limit)}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <i />
                      剩余流量
                    </dt>
                    <dd>
                      {traffic.unlimited
                        ? "不限"
                        : formatBytes(Math.max(0, traffic.remaining))}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="luminous-asset-mini">
                <div>
                  <CalendarClock />
                  <span>
                    <strong>
                      {workbench.expireDays == null
                        ? "到期未设置"
                        : workbench.expireDays < 0
                          ? "已过期"
                          : workbench.expireDays + " 天后到期"}
                    </strong>
                    <small>续费 {formatRenewalPrice(node) || "未填写"}</small>
                  </span>
                </div>
                <div>
                  <Layers />
                  <span>
                    <small>资料完整度</small>
                    <strong>
                      {workbench.completeness.complete} /{" "}
                      {workbench.completeness.total}
                    </strong>
                    <small>
                      {workbench.completeness.missing.length
                        ? "缺少 " +
                          workbench.completeness.missing.length +
                          " 项信息"
                        : "关键资料完整"}
                    </small>
                  </span>
                </div>
              </div>
            </section>
          </aside>
        )}
      </div>
      <details
        className="luminous-node-details luminous-glass"
        key={node.uuid}
        open={params.get("focus") === "expiry" ? true : undefined}
      >
        <summary>
          <span>
            <strong>节点资料与资产明细</strong>
            <small>系统、Agent、资源、网络、续费与状态说明</small>
          </span>
          <span className="luminous-node-detail-meta">
            资料 {workbench.completeness.complete}/
            {workbench.completeness.total} ·{" "}
            {workbench.expireDays == null
              ? "到期未设置"
              : workbench.expireDays < 0
                ? "已过期"
                : workbench.expireDays + " 天后到期"}
          </span>
          <ChevronDown size={17} />
        </summary>
        <div className="luminous-node-details-body">{details}</div>
      </details>
    </section>
  );
}
function MetricMini({ values }: { values: number[] }) {
  const samples = values.filter(Number.isFinite).slice(-20);
  const maximum = Math.max(1, ...samples);
  return (
    <svg
      className="luminous-metric-mini"
      viewBox="0 0 160 45"
      aria-label={samples.length ? "实际历史采样" : "暂无历史采样"}
      role="img"
    >
      <path
        d={samples
          .map(
            (value, i) =>
              (i ? "L" : "M") +
              (i / Math.max(1, samples.length - 1)) * 160 +
              "," +
              (43 - (value / maximum) * 34),
          )
          .join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      {samples.slice(-10).map((value, i) => (
        <rect
          key={i}
          x={80 + i * 8}
          y={44 - (value / maximum) * 35}
          width="5"
          height={Math.max(1, (value / maximum) * 35)}
          rx="1.5"
          fill="currentColor"
          opacity={0.22 + i * 0.075}
        />
      ))}
    </svg>
  );
}
