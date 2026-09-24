import type { LoadRecord } from "@/types/komari";

const TRAFFIC_COUNTER_BOUNDARY_TOLERANCE_MS = 15 * 60_000;

export interface TrafficRangePoint {
  time: number;
  up: number;
  down: number;
}

export interface TrafficRangeUsage {
  up: number;
  down: number;
  total: number;
  quality: "measured" | "partial" | "unavailable";
  coverageStart: number | null;
  coverageEnd: number | null;
  points: TrafficRangePoint[];
  sampleCount: number;
}

interface TimedCounters {
  time: number;
  up: number;
  down: number;
}

function toTimestamp(value: string | number) {
  if (typeof value === "number") {
    const milliseconds = value > 1_000_000_000_000 ? value : value * 1_000;
    return Number.isFinite(milliseconds) ? milliseconds : 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toCounter(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function unavailableUsage(): TrafficRangeUsage {
  return {
    up: 0,
    down: 0,
    total: 0,
    quality: "unavailable",
    coverageStart: null,
    coverageEnd: null,
    points: [],
    sampleCount: 0,
  };
}

/**
 * Derive traffic used in a selected time window from Komari's cumulative
 * network counters. A nearby sample before the window acts as the baseline;
 * if it is unavailable, usage starts at the first in-range sample and the
 * result is explicitly marked partial rather than overstating coverage.
 */
export function getTrafficRangeUsage(
  records: LoadRecord[] | undefined,
  start: number,
  end: number,
): TrafficRangeUsage {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return unavailableUsage();
  }

  const sorted = (records ?? [])
    .map((record): TimedCounters => ({
      time: toTimestamp(record.time),
      up: toCounter(record.net_total_up),
      down: toCounter(record.net_total_down),
    }))
    .filter((record) => record.time > 0 && record.time <= end)
    .sort((left, right) => left.time - right.time);

  const deduplicated = sorted.filter((record, index) =>
    index === sorted.length - 1 || record.time !== sorted[index + 1]?.time,
  );
  const inRange = deduplicated.filter((record) => record.time >= start);
  if (inRange.length === 0) return unavailableUsage();

  const previous = deduplicated.filter((record) => record.time < start).at(-1);
  const exactBoundary = inRange[0]?.time === start ? inRange[0] : undefined;
  const nearbyBoundary = Boolean(
    previous && start - previous.time <= TRAFFIC_COUNTER_BOUNDARY_TOLERANCE_MS,
  );
  const hasStartBoundary = Boolean(exactBoundary || nearbyBoundary);
  const baseline = exactBoundary ?? (nearbyBoundary ? previous! : inRange[0]!);
  const latestInRange = inRange.at(-1)!;
  const hasEndBoundary = end - latestInRange.time <= TRAFFIC_COUNTER_BOUNDARY_TOLERANCE_MS;
  const samples = inRange.filter((record) => record.time > baseline.time);
  const points: TrafficRangePoint[] = [{
    time: Math.max(start, baseline.time) / 1_000,
    up: 0,
    down: 0,
  }];

  let up = 0;
  let down = 0;
  let previousUp = baseline.up;
  let previousDown = baseline.down;
  let counterReset = false;

  for (const sample of samples) {
    if (sample.up < previousUp) {
      up += sample.up;
      counterReset = true;
    } else {
      up += sample.up - previousUp;
    }
    if (sample.down < previousDown) {
      down += sample.down;
      counterReset = true;
    } else {
      down += sample.down - previousDown;
    }
    previousUp = sample.up;
    previousDown = sample.down;
    points.push({ time: sample.time / 1_000, up, down });
  }

  return {
    up,
    down,
    total: up + down,
    quality: hasStartBoundary && hasEndBoundary && !counterReset ? "measured" : "partial",
    coverageStart: inRange[0]?.time ?? null,
    coverageEnd: latestInRange.time,
    points,
    sampleCount: inRange.length,
  };
}
