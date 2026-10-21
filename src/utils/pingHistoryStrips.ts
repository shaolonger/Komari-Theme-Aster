import type { PingOverviewSample } from "@/types/komari";
import { isValidPingLatency } from "./pingSamples";
/** Equal-duration buckets over the actual supplied history; gaps stay empty. */
export function buildPingHistoryStrips(samples: PingOverviewSample[], count = 24) {
  const ordered = samples.filter(s => Number.isFinite(s.time)).sort((a, b) => a.time - b.time);
  const buckets = Array.from({ length: count }, () => ({ total: 0, lost: 0, sum: 0 }));
  if (ordered.length) {
    const first = ordered[0].time, span = ordered[ordered.length - 1].time - first;
    for (const s of ordered) {
      const index = span > 0 ? Math.min(count - 1, Math.floor((s.time - first) / span * count)) : count - 1;
      const b = buckets[index];
      const total = Number.isFinite(s.sampleCount) ? Math.max(1, Math.round(s.sampleCount!)) : 1;
      const lost = Number.isFinite(s.lossCount) ? Math.min(total, Math.max(0, s.lossCount!)) : isValidPingLatency(s.value) ? 0 : total;
      b.total += total; b.lost += lost;
      if (isValidPingLatency(s.value)) b.sum += s.value * (total - lost);
    }
  }
  return buckets.map(b => ({ latency: b.total > b.lost ? b.sum / (b.total - b.lost) : null, loss: b.total ? b.lost / b.total * 100 : null }));
}
