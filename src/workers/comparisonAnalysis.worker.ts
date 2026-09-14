/// <reference lib="webworker" />
import { analyzeMultiMetricComparisonSeries } from "@/utils/vpsCompare";
import {
  unpackComparisonSeries,
  type ComparisonAnalysisWorkerRequest,
  type ComparisonAnalysisWorkerResponse,
} from "@/workers/comparisonAnalysisProtocol";

self.onmessage = (event: MessageEvent<ComparisonAnalysisWorkerRequest>) => {
  try {
    const analysis = analyzeMultiMetricComparisonSeries(unpackComparisonSeries(event.data.input));
    // 点数组已经由主线程持有，返回统计和洞察即可，避免再复制一遍大历史数据。
    analysis.seriesByMetric = {};
    for (const row of analysis.rows) {
      for (const cell of Object.values(row.cells)) {
        if (cell) cell.points = [];
      }
    }
    self.postMessage({ id: event.data.id, analysis } satisfies ComparisonAnalysisWorkerResponse);
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies ComparisonAnalysisWorkerResponse);
  }
};

export {};
