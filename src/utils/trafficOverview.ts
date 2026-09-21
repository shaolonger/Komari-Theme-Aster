import type { LoadRecord, NodeInfo } from "@/types/komari";

export type HomeTrafficPeriod = "today" | "month" | "total";

export interface HomeOverviewNode {
  uuid: string;
  name: string;
  group: string;
  region: string;
  online: boolean | null;
  updatedAt: number;
  netUp: number;
  netDown: number;
  trafficUp: number;
  trafficDown: number;
  expiredAt: string | number | null | undefined;
}

export interface HomeTrafficUsage {
  up: number;
  down: number;
  total: number;
}

export interface HomeTrafficOverviewRow extends HomeOverviewNode {
  today: HomeTrafficUsage;
  month: HomeTrafficUsage;
  total: HomeTrafficUsage;
}

function safeCounter(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function toTimestamp(value: string | number) {
  if (typeof value === "number") {
    const milliseconds = value > 1_000_000_000_000 ? value : value * 1_000;
    return Number.isFinite(milliseconds) ? milliseconds : 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getHomeTrafficPeriodStart(period: Exclude<HomeTrafficPeriod, "total">, now = Date.now()) {
  const date = new Date(now);
  if (period === "month") date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function getCounter(record: LoadRecord, direction: "up" | "down") {
  return safeCounter(direction === "up" ? record.net_total_up : record.net_total_down);
}

function resolvePeriodCounter(
  records: LoadRecord[] | undefined,
  direction: "up" | "down",
  current: number,
  start: number,
  now: number,
) {
  const sorted = (records ?? [])
    .map((record) => ({ record, time: toTimestamp(record.time) }))
    .filter((item) => item.time > 0 && item.time <= now)
    .sort((left, right) => left.time - right.time);
  const inPeriod = sorted.filter((item) => item.time >= start);
  const beforePeriod = sorted.filter((item) => item.time < start).at(-1);
  const baseline = beforePeriod ?? inPeriod[0];
  const latest = inPeriod.at(-1) ?? sorted.at(-1);
  if (!latest && !baseline) return safeCounter(current);

  const latestValue = safeCounter(current) || getCounter(latest?.record ?? baseline!.record, direction);
  const baselineValue = baseline ? getCounter(baseline.record, direction) : 0;
  if (latestValue >= baselineValue) return latestValue - baselineValue;
  // A restarted agent or a billing-cycle rollover resets the backend counter.
  return latestValue;
}

export function getHomeTrafficUsage(
  records: LoadRecord[] | undefined,
  period: Exclude<HomeTrafficPeriod, "total">,
  currentUp: number,
  currentDown: number,
  now = Date.now(),
): HomeTrafficUsage {
  const start = getHomeTrafficPeriodStart(period, now);
  const up = resolvePeriodCounter(records, "up", currentUp, start, now);
  const down = resolvePeriodCounter(records, "down", currentDown, start, now);
  return { up, down, total: up + down };
}

export function buildHomeTrafficOverview(
  nodes: HomeOverviewNode[],
  recordsByUuid: Record<string, LoadRecord[]> = {},
  now = Date.now(),
): HomeTrafficOverviewRow[] {
  return nodes.map((node) => ({
    ...node,
    today: getHomeTrafficUsage(recordsByUuid[node.uuid], "today", node.trafficUp, node.trafficDown, now),
    month: getHomeTrafficUsage(recordsByUuid[node.uuid], "month", node.trafficUp, node.trafficDown, now),
    total: {
      up: safeCounter(node.trafficUp),
      down: safeCounter(node.trafficDown),
      total: safeCounter(node.trafficUp) + safeCounter(node.trafficDown),
    },
  }));
}

export function buildHomeOverviewNode(meta: NodeInfo, realtime: {
  online: boolean | null;
  updatedAt: number;
  netUp: number;
  netDown: number;
  trafficUp: number;
  trafficDown: number;
}) : HomeOverviewNode {
  return {
    uuid: meta.uuid,
    name: meta.name.trim() || meta.uuid,
    group: String(meta.group ?? "").trim(),
    region: String(meta.region ?? "").trim(),
    online: realtime.online,
    updatedAt: Number.isFinite(realtime.updatedAt) ? realtime.updatedAt : 0,
    netUp: safeCounter(realtime.netUp),
    netDown: safeCounter(realtime.netDown),
    trafficUp: safeCounter(realtime.trafficUp),
    trafficDown: safeCounter(realtime.trafficDown),
    expiredAt: meta.expired_at,
  };
}
