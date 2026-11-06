import { networkTrends } from "./networkTrends";
import { analyzeReport } from "./insights";
import type {
  MetricStats,
  PingStats,
  ReportInput,
  ReportMetric,
  ReportModel,
  ReportPing,
  ReportPoint,
  ReportRange,
  TrafficStats,
} from "./model";

export function orderedPoints(points: ReportPoint[], range: ReportRange) {
  const byTime = new Map<number, ReportPoint>();
  for (const p of points)
    if (Number.isFinite(p.t) && p.t >= range.start && p.t < range.end)
      byTime.set(p.t, {
        ...p,
        v: p.v != null && Number.isFinite(p.v) ? p.v : null,
      });
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

// Adjacent retention tiers can have different cadences. Look on both sides of
// a candidate interval; one global median misclassifies coarser old samples.
function localInterval(points: ReportPoint[], index: number, fallback: number) {
  const side = (from: number, direction: -1 | 1) => {
    const values: number[] = [];
    for (let i = from; i >= 1 && i < points.length && values.length < 3; i += direction) {
      if (points[i - 1]!.v == null || points[i]!.v == null) break;
      const delta = points[i]!.t - points[i - 1]!.t;
      if (delta > 0) values.push(delta);
    }
    values.sort((a, b) => a - b);
    return values.length ? values[Math.floor((values.length - 1) / 2)]! : 0;
  };
  return Math.max(side(index, -1), side(index + 2, 1)) || fallback;
}

export function metricStats(
  points: ReportPoint[],
  range: ReportRange,
): MetricStats {
  const all = orderedPoints(points, range);
  const valid = all.filter(
    (p): p is ReportPoint & { v: number } => p.v != null,
  );
  const diffs = all
    .slice(1)
    .map((p, i) => p.v != null && all[i]!.v != null ? p.t - all[i]!.t : 0)
    .filter((x) => x > 0)
    .sort((a, b) => a - b);
  // Cadence is inferred, not a claim of a complete historical event stream.
  const intervalMs = diffs.length
    ? diffs[Math.floor((diffs.length - 1) / 2)]!
    : 0;
  const gaps: MetricStats["gaps"] = [];
  let coveredMs = 0,
    sum = 0;
  let cursor = range.start;
  for (let i = 0; i < all.length; i++) {
    const p = all[i]!;
    if (p.v == null || !intervalMs) continue;
    const next = all[i + 1]?.t ?? range.end;
    const cadence = localInterval(all, i, intervalMs);
    const delta = next - p.t;
    const continuous = all[i + 1]?.v != null && delta <= cadence * 1.5;
    const stop = Math.min(next, p.t + (continuous ? delta : cadence), range.end);
    if (p.t > cursor) gaps.push({ start: cursor, end: p.t });
    const weight = Math.max(0, stop - p.t);
    sum += p.v * weight;
    coveredMs += weight;
    cursor = stop;
  }
  if (cursor < range.end) gaps.push({ start: cursor, end: range.end });
  const sorted = valid.map((p) => p.v).sort((a, b) => a - b);
  return {
    count: valid.length,
    mean: coveredMs
      ? sum / coveredMs
      : valid.length
        ? valid.reduce((s, p) => s + p.v, 0) / valid.length
        : null,
    min: sorted[0] ?? null,
    max: sorted.at(-1) ?? null,
    p95: sorted.length
      ? sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!
      : null,
    first: valid[0]?.v ?? null,
    last: valid.at(-1)?.v ?? null,
    coveredMs,
    intervalMs,
    gaps,
  };
}

export function pingStats(ping: ReportPing): PingStats {
  let sent = 0,
    lost = 0,
    valid = 0,
    weighted = 0;
  for (const p of ping.points) {
    sent += p.sent;
    lost += p.lost;
    if (p.v != null && p.v >= 0 && p.valid > 0) {
      valid += p.valid;
      weighted += p.v * p.valid;
    }
  }
  return {
    sent,
    lost,
    valid,
    mean: valid ? weighted / valid : null,
    loss: sent ? lost / sent : null,
  };
}

export function trafficStats(
  metrics: ReportMetric[],
  range: ReportRange,
): TrafficStats {
  const daily = new Map<
    string,
    { date: string; up: number | null; down: number | null }
  >();
  const dateFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone: range.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  let partial = false,
    resets = 0;
  const direction = (key: string, name: "up" | "down") => {
    const points = orderedPoints(
      metrics.find((m) => m.key === key)?.points ?? [],
      range,
    ).filter((p): p is ReportPoint & { v: number } => p.v != null && p.v >= 0);
    if (points.length < 2) {
      partial = true;
      return null;
    }
    const stats = metricStats(points, range);
    // No interpolation outside measured boundaries. Totals are observed lower bounds.
    if (
      points[0]!.t !== range.start ||
      points.at(-1)!.t < range.end - 1 ||
      stats.gaps.length
    )
      partial = true;
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!,
        b = points[i]!;
      if (b.v < a.v) {
        resets++;
        partial = true;
        continue;
      }
      if (b.t - a.t > localInterval(points, i - 1, stats.intervalMs) * 1.5) partial = true;
      const delta = b.v - a.v;
      total += delta;
      const date = dateFormat.format(b.t),
        item = daily.get(date) ?? { date, up: null, down: null };
      item[name] = (item[name] ?? 0) + delta;
      daily.set(date, item);
    }
    return total;
  };
  const up = direction("net_total_up", "up"),
    down = direction("net_total_down", "down");
  return {
    up,
    down,
    partial,
    resets,
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export function buildReport(input: ReportInput): ReportModel {
  input = {
    ...input,
    metrics: input.metrics.map((m) => ({
      ...m,
      points: orderedPoints(m.points, input.range),
    })),
    pings: input.pings.map((p) => ({
      ...p,
      points: [...p.points].sort((a, b) => a.t - b.t),
    })),
  };
  const stats = Object.fromEntries(
    input.metrics.map((m) => [m.key, metricStats(m.points, input.range)]),
  );
  const pings = Object.fromEntries(
    input.pings.map((p) => [p.id, pingStats(p)]),
  );
  const traffic = trafficStats(input.metrics, input.range);
  const rules = { cpu: 80, memory: 85, disk: 85, version: "aster-report-2" };
  const findings: ReportModel["findings"] = [];
  const model: ReportModel = {
    ...input,
    stats,
    pingStats: pings,
    traffic,
    findings,
    rules,
    networkTrends: networkTrends(input.network),
    previousStats: input.previous
      ? Object.fromEntries(
          input.previous.metrics.map((m) => [
            m.key,
            metricStats(m.points, input.previous!.range),
          ]),
        )
      : undefined,
    previousPingStats: input.previous
      ? Object.fromEntries(
          input.previous.pings.map((p) => [p.id, pingStats(p)]),
        )
      : undefined,
  };
  model.analysis = analyzeReport(model);
  model.findings = model.analysis.actions.map(action => ({ chapter: action.chapter, severity: action.priority === "info" ? "info" : "warning", title: action.title, detail: action.observation, time: action.time }));
  model.rules.version = "aster-report-2";
  return model;
}
