import { useMemo } from "react";
import type { HomepagePingSourceRow } from "@/utils/homepagePingSources";
import { latencyHeatColor, lossHeatColor } from "@/utils/metricTone";
import { buildPingHistoryStrips } from "@/utils/pingHistoryStrips";
export function PingHistoryBars({ source }: { source: HomepagePingSourceRow }) {
  const buckets = useMemo(() => buildPingHistoryStrips(source.samples), [source.samples]);
  return <div className="ping-history-strips" aria-label={`${source.name} 延迟及丢包趋势，灰色为缺测`}>
    {(["latency", "loss"] as const).map(kind => <div className="ping-history-strip" key={kind}>{buckets.map((b, i) => <span key={i} title={b[kind] == null ? "缺测" : kind === "latency" ? `${b.latency!.toFixed(1)} ms` : `丢包 ${b.loss!.toFixed(1)}%`} style={{ background: b[kind] == null ? (kind === "latency" && b.loss != null ? "var(--status-error)" : "var(--progress-bg)") : kind === "latency" ? latencyHeatColor(b.latency) : lossHeatColor(b.loss) }}/>)}</div>)}
  </div>;
}
