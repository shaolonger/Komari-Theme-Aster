import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeMultiMetricComparisonSeries,
  type ComparisonMultiMetricAnalysis,
  type ComparisonMultiMetricSeriesInput,
} from "@/utils/vpsCompare";
import {
  hydrateComparisonAnalysisPoints,
  packComparisonSeries,
  type ComparisonAnalysisWorkerRequest,
  type ComparisonAnalysisWorkerResponse,
} from "@/workers/comparisonAnalysisProtocol";

export const COMPARISON_WORKER_SAMPLE_THRESHOLD = 4_000;

function sampleCount(input: ComparisonMultiMetricSeriesInput) {
  return input.metricKeys.reduce(
    (total, metricKey) => total + (input.seriesByMetric[metricKey] ?? [])
      .reduce((metricTotal, series) => metricTotal + series.points.length, 0),
    0,
  );
}

function analysisKey(input: ComparisonMultiMetricSeriesInput) {
  const pieces = input.metricKeys.map((metricKey) => {
    const series = input.seriesByMetric[metricKey] ?? [];
    const samples = series.reduce((total, item) => total + item.points.length, 0);
    const last = series.reduce((latest, item) => Math.max(
      latest,
      item.points[item.points.length - 1]?.time ?? 0,
    ), 0);
    return `${metricKey}:${series.length}:${samples}:${last}`;
  });
  return `${input.nodes.map((node) => node.uuid).join(",")}|${pieces.join("|")}`;
}

export function useComparisonAnalysis(
  input: ComparisonMultiMetricSeriesInput,
): { analysis: ComparisonMultiMetricAnalysis; workerActive: boolean } {
  const count = sampleCount(input);
  const key = analysisKey(input);
  const requestId = useRef(0);
  const [workerResult, setWorkerResult] = useState<{
    key: string;
    analysis: ComparisonMultiMetricAnalysis;
  } | null>(null);
  const useWorker = count > COMPARISON_WORKER_SAMPLE_THRESHOLD && typeof Worker !== "undefined";
  const synchronous = useMemo(
    () => useWorker ? null : analyzeMultiMetricComparisonSeries(input),
    [input, useWorker],
  );

  useEffect(() => {
    if (!useWorker) return;
    const worker = new Worker(
      new URL("../workers/comparisonAnalysis.worker.ts", import.meta.url),
      { type: "module", name: "komari-comparison-analysis" },
    );
    const id = ++requestId.current;
    const packed = packComparisonSeries(input);
    worker.onmessage = (event: MessageEvent<ComparisonAnalysisWorkerResponse>) => {
      if (event.data.id !== id || !event.data.analysis) return;
      setWorkerResult({
        key,
        analysis: hydrateComparisonAnalysisPoints(event.data.analysis, input.seriesByMetric),
      });
      worker.terminate();
    };
    worker.onerror = () => {
      setWorkerResult({ key, analysis: analyzeMultiMetricComparisonSeries(input) });
      worker.terminate();
    };
    worker.postMessage({ id, input: packed.input } satisfies ComparisonAnalysisWorkerRequest, packed.transfer);
    return () => worker.terminate();
  }, [input, key, useWorker]);

  if (synchronous) return { analysis: synchronous, workerActive: false };
  if (workerResult?.key === key) return { analysis: workerResult.analysis, workerActive: false };
  return {
    analysis: { metricKeys: input.metricKeys, seriesByMetric: input.seriesByMetric, rows: [], insights: [] },
    workerActive: true,
  };
}
