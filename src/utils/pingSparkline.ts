import { isValidPingLatency } from "@/utils/pingSamples";

export interface PingSparklineGeometry {
  paths: string[];
  lossMarkers: number[];
}

interface PingSparklineOptions {
  width?: number;
  height?: number;
  baselineMax?: number;
  maxPoints?: number;
  markerInset?: number;
}

type PingSample = { time: number; value: number };
type SparkPoint = { x: number; y: number };

function smoothPath(points: SparkPoint[], width: number) {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const point = points[0];
    return `M ${Math.max(0, point.x - 1.4)} ${point.y} L ${Math.min(
      width,
      point.x + 1.4,
    )} ${point.y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const after = points[index + 2] ?? next;
    const control1X = current.x + (next.x - previous.x) / 6;
    const control1Y = current.y + (next.y - previous.y) / 6;
    const control2X = next.x - (after.x - current.x) / 6;
    const control2Y = next.y - (after.y - current.y) / 6;
    path += ` C ${control1X} ${control1Y}, ${control2X} ${control2Y}, ${next.x} ${next.y}`;
  }
  return path;
}

/**
 * Bounds the amount of path data without ever discarding a loss event.
 * Neighbours around every loss are retained so the line remains visibly broken.
 */
function selectVisualSamples(samples: PingSample[], maxPoints: number) {
  if (samples.length <= maxPoints) return samples;

  const retained = new Set<number>([0, samples.length - 1]);
  const stride = Math.max(1, Math.ceil(samples.length / maxPoints));
  for (let index = 0; index < samples.length; index += stride) {
    retained.add(index);
  }
  for (let index = 0; index < samples.length; index += 1) {
    if (isValidPingLatency(samples[index].value)) continue;
    retained.add(index);
    if (index > 0) retained.add(index - 1);
    if (index + 1 < samples.length) retained.add(index + 1);
  }

  return [...retained]
    .sort((left, right) => left - right)
    .map((index) => samples[index]);
}

/**
 * Builds a one-hour card sparkline from every sample in the supplied overview
 * window. Path points may be decimated, but packet-loss sentinels are preserved.
 */
export function buildPingSparklineGeometry(
  samples: PingSample[],
  {
    width = 100,
    height = 22,
    baselineMax = 300,
    maxPoints = 120,
    markerInset = 1,
  }: PingSparklineOptions = {},
): PingSparklineGeometry {
  const ordered = samples
    .filter((sample) => Number.isFinite(sample.time))
    .sort((left, right) => left.time - right.time);
  if (ordered.length === 0) return { paths: [], lossMarkers: [] };

  const selected = selectVisualSamples(ordered, Math.max(2, maxPoints));
  const validValues = ordered
    .map((sample) => sample.value)
    .filter(isValidPingLatency);
  const scaleMax = Math.max(baselineMax, ...validValues, 1);
  const firstTime = ordered[0].time;
  const lastTime = ordered[ordered.length - 1].time;
  const timeSpan = Math.max(0, lastTime - firstTime);
  const xForSample = (sample: PingSample, index: number) => {
    if (ordered.length <= 1) return width / 2;
    if (timeSpan <= 0) return (index / Math.max(1, selected.length - 1)) * width;
    return Math.max(
      0,
      Math.min(width, ((sample.time - firstTime) / timeSpan) * width),
    );
  };
  const yForValue = (value: number) => {
    const ratio = Math.min(1, value / scaleMax);
    return height - 2.5 - ratio * (height - 5);
  };

  const segments: SparkPoint[][] = [];
  const lossMarkers: number[] = [];
  const markerKeys = new Set<number>();
  let activeSegment: SparkPoint[] = [];

  selected.forEach((sample, index) => {
    const x = xForSample(sample, index);
    if (!isValidPingLatency(sample.value)) {
      if (activeSegment.length > 0) segments.push(activeSegment);
      activeSegment = [];
      const markerX = Math.max(markerInset, Math.min(width - markerInset, x));
      const markerKey = Math.round(markerX * 2) / 2;
      if (!markerKeys.has(markerKey)) {
        markerKeys.add(markerKey);
        lossMarkers.push(markerX);
      }
      return;
    }
    activeSegment.push({ x, y: yForValue(sample.value) });
  });
  if (activeSegment.length > 0) segments.push(activeSegment);

  return {
    paths: segments.map((points) => smoothPath(points, width)).filter(Boolean),
    lossMarkers,
  };
}
