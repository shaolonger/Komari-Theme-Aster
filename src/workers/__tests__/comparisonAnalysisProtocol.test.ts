import { describe, expect, it } from "vitest";
import {
  analyzeMultiMetricComparisonSeries,
  type ComparisonMultiMetricSeriesInput,
} from "@/utils/vpsCompare";
import {
  hydrateComparisonAnalysisPoints,
  packComparisonSeries,
  unpackComparisonSeries,
} from "@/workers/comparisonAnalysisProtocol";

const fixture: ComparisonMultiMetricSeriesInput = {
  metricKeys: ["cpu", "ping_latency"],
  nodes: [
    { uuid: "a", name: "Alpha" },
    { uuid: "b", name: "Beta" },
  ],
  seriesByMetric: {
    cpu: [
      { uuid: "a", name: "Alpha", group: "", region: "", points: [{ time: 1, value: 10 }, { time: 2, value: 30 }] },
      { uuid: "b", name: "Beta", group: "", region: "", points: [{ time: 1, value: 80 }, { time: 2, value: 90 }] },
    ],
    ping_latency: [
      { uuid: "a", name: "Alpha", group: "", region: "", points: [{ time: 1, value: 15 }] },
      { uuid: "b", name: "Beta", group: "", region: "", points: [{ time: 1, value: 150 }] },
    ],
  },
};

describe("typed-array comparison worker protocol", () => {
  it("round-trips series without precision or ordering loss", () => {
    const packed = packComparisonSeries(fixture);
    expect(packed.transfer).toHaveLength(4);
    const unpacked = unpackComparisonSeries(packed.input);
    expect(unpacked).toEqual(fixture);
    expect(analyzeMultiMetricComparisonSeries(unpacked).rows.map((row) => row.uuid))
      .toEqual(analyzeMultiMetricComparisonSeries(fixture).rows.map((row) => row.uuid));
  });

  it("rehydrates worker statistics with main-thread point references", () => {
    const stripped = analyzeMultiMetricComparisonSeries(fixture);
    stripped.seriesByMetric = {};
    for (const row of stripped.rows) {
      for (const cell of Object.values(row.cells)) if (cell) cell.points = [];
    }
    const hydrated = hydrateComparisonAnalysisPoints(stripped, fixture.seriesByMetric);
    expect(hydrated.rows.find((row) => row.uuid === "b")?.cells.cpu?.points).toBe(
      fixture.seriesByMetric.cpu?.[1]?.points,
    );
  });
});
