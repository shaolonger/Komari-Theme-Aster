import type { CSSProperties, ReactNode } from "react";
import {
  CalendarDays,
  ChevronDown,
  Clock3,
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
  Radio,
  Server,
} from "lucide-react";
import { useLoadRecords } from "@/hooks/useRecords";
import { usePingMini } from "@/hooks/usePingMini";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { useSearchParams } from "react-router-dom";
import {
  formatBytes,
  formatMetricPercent,
  formatUptimeDays,
} from "@/utils/format";
import { formatDisplayDateTime } from "@/utils/timeDisplay";
import { formatRenewalPrice } from "@/utils/billing";
import { resolveTrafficUsage, trafficTypeLabel } from "@/utils/traffic";
import type { NodeInfo, NodeMetrics } from "@/types/komari";
import type { VpsWorkbenchNode } from "@/utils/vpsWorkbench";
import type { InstanceView } from "@/utils/instanceView";

export default function CupertinoInstanceSummary({
  node,
  loss,
  workbench,
  view,
  details,
  children,
  navigation,
}: {
  node: NodeInfo & NodeMetrics;
  loss: number | null | undefined;
  workbench: VpsWorkbenchNode;
  view: InstanceView;
  details: ReactNode;
  children?: ReactNode;
  navigation?: ReactNode;
}) {
  const { data } = useLoadRecords(node.uuid, 1, view === "load", node),
    ping = usePingMini(node.uuid),
    settings = useThemeSettings(),
    [params] = useSearchParams();
  const samples = data?.records || [],
    uptime = formatUptimeDays(node.uptime),
    cached = node.online === false;
  const observed = node.updatedAt > 0;
  const metrics = [
    {
      label: "CPU 使用率",
      icon: Cpu,
      value: observed ? formatMetricPercent(node.cpuPct) : "—",
      suffix: "",
      color: "#007aff",
      values: samples.map((r) => r.cpu),
    },
    {
      label: "内存使用",
      icon: MemoryStick,
      value: observed ? formatBytes(node.ramUsed) : "—",
      suffix: "/ " + formatBytes(node.ramTotal),
      color: "#af52de",
      values: samples.map((r) =>
        r.ram_total ? (r.ram / r.ram_total) * 100 : NaN,
      ),
    },
    {
      label: "磁盘使用",
      icon: HardDrive,
      value: observed ? formatBytes(node.diskUsed) : "—",
      suffix: "/ " + formatBytes(node.diskTotal),
      color: "#34a853",
      values: samples.map((r) =>
        r.disk_total ? (r.disk / r.disk_total) * 100 : NaN,
      ),
    },
    {
      label: "Ping 状态",
      icon: Radio,
      value: loss == null ? "暂无观测" : formatMetricPercent(loss),
      suffix:
        loss == null ? "" : loss >= 20 ? "高丢包" : loss >= 5 ? "波动" : "正常",
      color: loss != null && loss >= 5 ? "#ff3b30" : "#34c759",
      values: ping.samples.map((s) =>
        s.sampleCount ? ((s.lossCount || 0) / s.sampleCount) * 100 : NaN,
      ),
    },
  ];
  const traffic = resolveTrafficUsage(
      node.traffic_limit_type,
      node.trafficUp,
      node.trafficDown,
      node.traffic_limit,
    ),
    pct = traffic.unlimited ? 0 : (traffic.used / traffic.limit) * 100;
  const rows = [
    ["操作系统", node.os || "未上报"],
    ["系统架构", node.arch || "未上报"],
    ["虚拟化", node.virtualization || "未上报"],
    ["监控 Agent", node.version || "未上报"],
    ["内核版本", node.kernel_version || "未上报"],
    ["硬件配置", `${node.cpu_cores} vCPU · ${formatBytes(node.ramTotal)} 内存`],
  ];
  const last = node.updatedAt
    ? formatDisplayDateTime(node.updatedAt, settings.displayTimeZone, {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "未上报";
  return (
    <section className="cupertino-instance-content" id="instance-summary">
      {cached && (
        <p className="cupertino-cache-notice" role="status">
          节点当前离线。资源、用量与运行时长为最后上报缓存，历史图表按所选范围显示。
        </p>
      )}
      {view === "load" && (
        <section
          className="cupertino-instance-metrics"
          aria-label="节点实时指标"
        >
          {metrics.map(
            ({ label, icon: Icon, value, suffix, color, values }) => (
              <article
                key={label}
                style={{ "--metric-color": color } as CSSProperties}
                data-alert={label === "Ping 状态" && loss != null && loss >= 5}
              >
                <div className="cupertino-metric-label">
                  <Icon size={19} />
                  {label}
                </div>
                <strong>
                  {value}
                  <small>{suffix}</small>
                </strong>
                <Mini values={values} />
              </article>
            ),
          )}
          <article data-metric="uptime">
            <div className="cupertino-metric-label">
              <Clock3 size={19} />
              运行时长
            </div>
            <strong>
              {observed ? uptime.value : "—"}{" "}
              <small>{observed ? uptime.unit : ""}</small>
            </strong>
            <p>
              {cached ? "最后上报" : "最近上报"} {last}
            </p>
          </article>
        </section>
      )}
      {navigation}
      <div
        className="cupertino-detail-columns"
        data-sidebar={view === "load" || view === "traffic"}
      >
        <div className="cupertino-detail-main">{children}</div>
        {(view === "load" || view === "traffic") && (
          <aside className="cupertino-detail-aside">
            <section className="cupertino-quota-panel">
              <h2>流量与续费</h2>
              <div className="cupertino-quota-overview">
                <div
                  className="cupertino-quota-ring"
                  style={
                    {
                      "--quota": Math.max(0, Math.min(100, pct)) + "%",
                    } as CSSProperties
                  }
                >
                  <span>
                    <strong>
                      {traffic.unlimited
                        ? "∞"
                        : observed
                          ? pct.toFixed(2) + "%"
                          : "—"}
                    </strong>
                    <small>
                      {traffic.unlimited
                        ? "未设上限"
                        : cached
                          ? "上报用量"
                          : "已使用"}
                    </small>
                  </span>
                </div>
                <dl>
                  {[
                    ["已用", observed ? formatBytes(traffic.used) : "未上报"],
                    [
                      "总额",
                      traffic.unlimited ? "不限" : formatBytes(traffic.limit),
                    ],
                    [
                      "剩余",
                      traffic.unlimited
                        ? "不限"
                        : observed
                          ? formatBytes(Math.max(0, traffic.remaining))
                          : "未知",
                    ],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>
                        <i />
                        {label}
                      </dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <p className="cupertino-quota-rule">
                {trafficTypeLabel(node.traffic_limit_type)}
              </p>
              <div className="cupertino-renewal">
                <span>
                  <CalendarDays size={17} />
                  {workbench.expireDays == null
                    ? "到期未设置"
                    : workbench.expireDays < 0
                      ? "已过期"
                      : workbench.expireDays + " 天后到期"}
                </span>
                <span>
                  续费 <strong>{formatRenewalPrice(node) || "未填写"}</strong>
                </span>
              </div>
            </section>
            <section className="cupertino-system-panel">
              <h2>系统与服务</h2>
              <dl>
                {rows.map(([label, value], i) => (
                  <div key={label}>
                    <dt>
                      {i === 0 ? (
                        <Server size={15} />
                      ) : i === 5 ? (
                        <Cpu size={15} />
                      ) : (
                        <Network size={15} />
                      )}{" "}
                      {label}
                    </dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <details
                className="cupertino-node-details"
                open={params.get("focus") === "expiry" ? true : undefined}
              >
                <summary>
                  完整资料与资产 <ChevronDown size={15} />
                </summary>
                <div>{details}</div>
              </details>
            </section>
          </aside>
        )}
      </div>
      {view !== "load" && view !== "traffic" && (
        <details className="cupertino-node-details cupertino-secondary-details">
          <summary>
            完整资料与资产 <ChevronDown size={15} />
          </summary>
          <div>{details}</div>
        </details>
      )}
    </section>
  );
}
function Mini({ values }: { values: number[] }) {
  const maximum = Math.max(1, ...values.filter(Number.isFinite)),
    points = values.slice(-24);
  return (
    <svg
      className="cupertino-metric-mini"
      viewBox="0 0 120 32"
      role="img"
      aria-label={
        points.some(Number.isFinite) ? "实际历史采样" : "暂无历史采样"
      }
    >
      <path
        d={points
          .map((v, i) =>
            Number.isFinite(v)
              ? `${i && Number.isFinite(points[i - 1]) ? "L" : "M"}${(i / Math.max(1, points.length - 1)) * 120},${30 - (v / maximum) * 25}`
              : "",
          )
          .join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}
