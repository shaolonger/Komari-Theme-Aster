import type { CSSProperties } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Cpu,
  HardDrive,
  MemoryStick,
  Radio,
} from "lucide-react";
import { useLoadRecords } from "@/hooks/useRecords";
import { useNodeTrafficTrend } from "@/hooks/useNode";
import { TrafficSparkline } from "@/components/node/TrafficSparkline";
import {
  formatBytes,
  formatMetricPercent,
  formatTrafficRateLabel,
} from "@/utils/format";
import type { NodeInfo, NodeMetrics } from "@/types/komari";

export default function OrbitalInstanceSummary({
  node,
  loss,
  state,
  luminous = false,
}: {
  node: NodeInfo & NodeMetrics;
  loss: number | null | undefined;
  luminous?: boolean;
  state: "none" | "critical" | "warning";
}) {
  const history = useLoadRecords(node.uuid, 1, true, node);
  const traffic = useNodeTrafficTrend(node.uuid);
  const metrics = [
    {
      label: "CPU 使用率",
      icon: Cpu,
      value: formatMetricPercent(node.cpuPct),
      detail: "",
      color: luminous ? "#0085ff" : "#10dafa",
      samples: (history.data?.records ?? []).map((r) => r.cpu),
    },
    {
      label: "内存使用率",
      icon: MemoryStick,
      value: formatMetricPercent(node.ramPct),
      detail: formatBytes(node.ramUsed),
      color: luminous ? "#9747ff" : "#a16cff",
      samples: (history.data?.records ?? []).map((r) =>
        r.ram_total > 0 ? (r.ram / r.ram_total) * 100 : NaN,
      ),
    },
    {
      label: "磁盘使用率",
      icon: HardDrive,
      value: formatMetricPercent(node.diskPct),
      detail: formatBytes(node.diskUsed),
      color: luminous ? "#ff980f" : "#f6ae55",
      samples: (history.data?.records ?? []).map((r) =>
        r.disk_total > 0 ? (r.disk / r.disk_total) * 100 : NaN,
      ),
    },
    {
      label: "Ping 丢包率",
      icon: Radio,
      value: loss == null ? "—" : formatMetricPercent(loss),
      detail: loss == null ? "暂无观测" : "最近主页观测",
      color: loss != null && loss >= 5 ? "#ff5877" : "#21d6b4",
      samples: [],
    },
  ];
  return (
    <>
      <section className="orbital-instance-metrics" aria-label="节点实时指标">
        {metrics.map(({ label, icon: Icon, value, detail, color, samples }) => (
          <article
            key={label}
            className="orbital-panel"
            style={{ "--metric-color": color } as CSSProperties}
          >
            <Icon />
            <div>
              <span>{label}</span>
              <strong>
                {value}
                <small>{detail}</small>
              </strong>
            </div>
            {samples.length > 0 ? (
              <MetricBars values={samples} color={color} />
            ) : (
              <span className="orbital-metric-glyph">
                <Activity />
              </span>
            )}
          </article>
        ))}
      </section>
      <aside className="orbital-health-panel orbital-panel">
        <h2>
          <Activity size={17} />
          节点状态概览
        </h2>
        <div className="orbital-health-body">
          <div
            className="orbital-health-ring"
            data-state={node.online !== true ? "offline" : state}
          >
            <strong>
              {node.online === false
                ? "离线"
                : node.online == null
                  ? "待上报"
                  : state === "none"
                    ? "在线"
                    : "关注"}
            </strong>
            <small>实时状态</small>
          </div>
          <dl>
            {metrics.map((m) => (
              <div key={m.label}>
                <dt>
                  <i style={{ background: m.color }} />
                  {m.label.replace("使用率", "")}
                </dt>
                <dd style={{ color: m.color }}>{m.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="orbital-health-network">
          <h2>网络 I/O</h2>
          <p>
            <span>
              <ArrowUp size={14} />
              {formatTrafficRateLabel(node.netUp)}
            </span>
            <span>
              <ArrowDown size={14} />
              {formatTrafficRateLabel(node.netDown)}
            </span>
          </p>
          <TrafficSparkline samples={traffic.up} color={luminous ? "#0085ff" : "#13daf7"} height={30} />
          <TrafficSparkline
            samples={traffic.down}
            color={luminous ? "#9852ff" : "#a06aff"}
            height={30}
          />
          <small>最近实时采样 · 上行 / 下行</small>
        </div>
      </aside>
    </>
  );
}
function MetricBars({ values, color }: { values: number[]; color: string }) {
  const points = values.filter(Number.isFinite).slice(-20),
    max = Math.max(1, ...points);
  return (
    <svg
      className="orbital-metric-bars"
      viewBox="0 0 90 32"
      role="img"
      aria-label="最近一小时可用历史采样"
    >
      {points.map((v, i) => (
        <rect
          key={i}
          x={(i * 90) / Math.max(1, points.length)}
          y={31 - Math.max(1, (v / max) * 29)}
          width={Math.max(1, 90 / Math.max(1, points.length) - 2)}
          height={Math.max(1, (v / max) * 29)}
          fill={color}
          opacity={0.35 + (i / Math.max(1, points.length)) * 0.65}
        />
      ))}
    </svg>
  );
}
