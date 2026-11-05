import { trimFixed } from "@/utils/format";
import type { TrafficDisplay } from "@/utils/traffic";
import type { CSSProperties } from "react";

export default function TrafficQuotaDetailsContent({ traffic }: { traffic: TrafficDisplay }) {
  const unlimited = traffic.remainingLabel === "∞";
  const percent = traffic.usagePercent ?? traffic.fraction * 100;
  return (
    <section className="sky-traffic-quota" aria-label="流量使用情况" title={`流量计费口径：${traffic.typeLabel}`}>
      <div className="sky-traffic-quota-head"><span>流量</span><strong className="tabular">{traffic.detail}</strong></div>
      <div className="sky-traffic-quota-track" role="progressbar" aria-label={unlimited ? "流量未设限" : "已用流量比例"}
        aria-valuenow={unlimited ? undefined : Math.round(traffic.fraction * 100)} aria-valuemin={0} aria-valuemax={100}
        aria-valuetext={unlimited ? "未设限" : `已用 ${trimFixed(percent, 2)}%，剩余 ${traffic.remainingLabel}`}>
        <i style={{ "--sky-quota-fill": `${traffic.fraction * 100}%`, "--sky-quota-color": percent >= 90 ? "var(--status-warning)" : "var(--progress-network)" } as CSSProperties} />
      </div>
      <div className="sky-traffic-quota-foot"><span>{unlimited ? "流量未设限" : `剩余 ${traffic.remainingLabel}`}</span><span className="tabular">{unlimited ? "不计算额度占比" : `已用 ${trimFixed(percent, 2)}%`}</span></div>
    </section>
  );
}
