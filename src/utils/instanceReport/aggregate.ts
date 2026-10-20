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
    .map((p, i) => p.t - all[i]!.t)
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
    const stop = Math.min(next, p.t + intervalMs, range.end);
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
      if (b.t - a.t > stats.intervalMs * 3) partial = true;
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
  const rules = { cpu: 80, memory: 85, disk: 85, version: "aster-report-1" };
  const findings: ReportModel["findings"] = [];
  for (const [key, threshold, label] of [
    ["cpu", rules.cpu, "CPU"],
    ["ram", rules.memory, "内存"],
    ["disk", rules.disk, "磁盘"],
  ] as const) {
    const m = input.metrics.find((x) => x.key === key),
      stat = stats[key];
    const denominator =
      key === "ram"
        ? input.node.memory
        : key === "disk"
          ? input.node.disk
          : 100;
    if (!m || stat?.max == null || !denominator) continue;
    const pct = (stat.max / denominator) * 100;
    if (pct > threshold)
      findings.push({
        chapter: "resources",
        severity: "warning",
        title: `${label}返回点高于 ${threshold}%`,
        detail: `最高返回点换算为 ${pct.toFixed(1)}%；精度为${m.precision}，不能推断瞬时峰值或连续超限时长。建议检查对应时间的任务与日志。`,
        time: m.points.find((p) => p.v === stat.max)?.t,
      });
  }
  for (const ping of input.pings) {
    const s = pings[ping.id]!;
    if (s.lost > 0)
      findings.push({
        chapter: "network",
        severity: "warning",
        title: `${ping.name}存在失败探测`,
        detail: `${s.lost}/${s.sent} 次，失败率 ${((s.loss ?? 0) * 100).toFixed(2)}%。请对照协议、目标与其他任务；这不是整台 VPS 的停机率。`,
        time: ping.points.find((p) => p.lost > 0)?.t,
      });
  }
  if (stats.cpu?.gaps.length)
    findings.push({
      chapter: "stability",
      severity: "info",
      title: "CPU 采集存在未知时段",
      detail: "按返回点间距估计覆盖，缺测不补零，也不视为已确认离线。",
      time: stats.cpu.gaps[0]?.start,
    });
  if (traffic.resets)
    findings.push({
      chapter: "traffic",
      severity: "warning",
      title: "累计流量计数器发生回退",
      detail: `${traffic.resets} 次回退段未计入已观测流量，实际用量可能更高。不能仅据此确定重启。`,
    });
  for (const source of input.sources.filter(
    (s) =>
      s.state === "failed" || s.state === "forbidden" || s.state === "partial",
  ))
    findings.push({
      chapter: "sources",
      severity: "info",
      title: `${source.name}：${source.state === "forbidden" ? "无权限" : "覆盖受限"}`,
      detail: source.detail,
    });
  return {
    ...input,
    stats,
    pingStats: pings,
    traffic,
    findings,
    rules,
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
}
