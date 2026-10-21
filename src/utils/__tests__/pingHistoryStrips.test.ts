import { describe, expect, it } from "vitest";
import { buildPingHistoryStrips } from "../pingHistoryStrips";
describe("segmented network history", () => {
  it("preserves gaps and loss instead of painting missing history green", () => {
    const strips = buildPingHistoryStrips([{ time: 0, value: 10 }, { time: 50, value: -1 }, { time: 100, value: 30 }], 5);
    expect(strips).toEqual([{ latency: 10, loss: 0 }, { latency: null, loss: null }, { latency: null, loss: 100 }, { latency: null, loss: null }, { latency: 30, loss: 0 }]);
  });
  it("counts every failure and averages only valid RTTs in a time bucket", () => {
    const strips = buildPingHistoryStrips([{ time: 0, value: 10 }, { time: 1, value: 20 }, { time: 2, value: 0 }, { time: 3, value: NaN }, { time: 100, value: 30 }], 2);
    expect(strips[0]).toEqual({ latency: 15, loss: 50 });
    expect(buildPingHistoryStrips([], 2)).toEqual([{ latency: null, loss: null }, { latency: null, loss: null }]);
  });
  it("preserves partial loss in server rollups", () => {
    const result = buildPingHistoryStrips([{ time: 5, value: 20, sampleCount: 10, lossCount: 2 }]);
    expect(result[23]).toEqual({ latency: 20, loss: 20 });
  });
  it("does not invent more samples for a single observation", () => {
    expect(buildPingHistoryStrips([{ time: 5, value: 30 }]).filter(b => b.loss != null)).toHaveLength(1);
  });
});
