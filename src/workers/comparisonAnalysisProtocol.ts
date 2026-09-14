import type {
  ComparisonMetricKey,
  ComparisonMultiMetricAnalysis,
  ComparisonMultiMetricSeriesInput,
  ComparisonNode,
  ComparisonSeries,
} from "@/utils/vpsCompare";

export interface PackedComparisonSeries {
  uuid: string;
  name: string;
  group: string;
  region: string;
  points: Float64Array;
}

export interface PackedComparisonAnalysisInput {
  metricKeys: ComparisonMetricKey[];
  nodes: ComparisonNode[];
  series: Partial<Record<ComparisonMetricKey, PackedComparisonSeries[]>>;
}

export interface ComparisonAnalysisWorkerRequest {
  id: number;
  input: PackedComparisonAnalysisInput;
}

export interface ComparisonAnalysisWorkerResponse {
  id: number;
  analysis?: ComparisonMultiMetricAnalysis;
  error?: string;
}

export function packComparisonSeries(
  input: ComparisonMultiMetricSeriesInput,
): { input: PackedComparisonAnalysisInput; transfer: Transferable[] } {
  const series: PackedComparisonAnalysisInput["series"] = {};
  const transfer: Transferable[] = [];
  for (const metricKey of input.metricKeys) {
    series[metricKey] = (input.seriesByMetric[metricKey] ?? []).map((item) => {
      const points = new Float64Array(item.points.length * 2);
      for (let index = 0; index < item.points.length; index += 1) {
        points[index * 2] = item.points[index].time;
        points[index * 2 + 1] = item.points[index].value;
      }
      transfer.push(points.buffer);
      return {
        uuid: item.uuid,
        name: item.name,
        group: item.group,
        region: item.region,
        points,
      };
    });
  }
  return {
    input: { metricKeys: input.metricKeys, nodes: input.nodes, series },
    transfer,
  };
}

export function unpackComparisonSeries(
  input: PackedComparisonAnalysisInput,
): ComparisonMultiMetricSeriesInput {
  const seriesByMetric: ComparisonMultiMetricSeriesInput["seriesByMetric"] = {};
  for (const metricKey of input.metricKeys) {
    seriesByMetric[metricKey] = (input.series[metricKey] ?? []).map((item): ComparisonSeries => {
      const points = new Array(item.points.length / 2);
      for (let index = 0; index < points.length; index += 1) {
        points[index] = { time: item.points[index * 2], value: item.points[index * 2 + 1] };
      }
      return { ...item, points };
    });
  }
  return { metricKeys: input.metricKeys, nodes: input.nodes, seriesByMetric };
}

export function hydrateComparisonAnalysisPoints(
  analysis: ComparisonMultiMetricAnalysis,
  seriesByMetric: ComparisonMultiMetricSeriesInput["seriesByMetric"],
): ComparisonMultiMetricAnalysis {
  const pointsByMetric = new Map<string, ComparisonSeries["points"]>();
  for (const metricKey of analysis.metricKeys) {
    for (const series of seriesByMetric[metricKey] ?? []) {
      pointsByMetric.set(`${metricKey}\u0000${series.uuid}`, series.points);
    }
  }
  return {
    ...analysis,
    seriesByMetric,
    rows: analysis.rows.map((row) => ({
      ...row,
      cells: Object.fromEntries(Object.entries(row.cells).map(([metricKey, cell]) => [
        metricKey,
        cell ? {
          ...cell,
          points: pointsByMetric.get(`${metricKey}\u0000${row.uuid}`) ?? [],
        } : cell,
      ])),
    })),
  };
}
