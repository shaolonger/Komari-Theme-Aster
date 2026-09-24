import { describe, expect, it } from "vitest";
import type { LoadRecord } from "@/types/komari";
import { getTrafficRangeUsage } from "@/utils/trafficRange";

const start = Date.parse("2026-09-24T00:00:00.000Z");
const end = Date.parse("2026-09-24T01:00:00.000Z");

function record(time: number, up: number, down: number) {
  return { time, net_total_up: up, net_total_down: down } as LoadRecord;
}

describe("traffic range usage", () => {
  it("calculates upload, download and total from a nearby counter boundary", () => {
    const result = getTrafficRangeUsage([
      record(start - 5 * 60_000, 1_000, 2_000),
      record(start + 10 * 60_000, 1_500, 2_250),
      record(end, 2_000, 3_000),
    ], start, end);

    expect(result).toMatchObject({
      up: 1_000,
      down: 1_000,
      total: 2_000,
      quality: "measured",
      coverageStart: start + 10 * 60_000,
      coverageEnd: end,
      sampleCount: 2,
    });
    expect(result.points).toEqual([
      { time: start / 1_000, up: 0, down: 0 },
      { time: (start + 10 * 60_000) / 1_000, up: 500, down: 250 },
      { time: end / 1_000, up: 1_000, down: 1_000 },
    ]);
  });

  it("accepts an exact start sample and requires a recent end sample", () => {
    const complete = getTrafficRangeUsage([
      record(start, 100, 200),
      record(end - 5 * 60_000, 300, 500),
    ], start, end);
    const incomplete = getTrafficRangeUsage([
      record(start, 100, 200),
    ], start, end);

    expect(complete).toMatchObject({ up: 200, down: 300, quality: "measured" });
    expect(incomplete).toMatchObject({ up: 0, down: 0, quality: "partial" });
  });

  it("marks missing boundary samples partial and starts at the first in-range sample", () => {
    const result = getTrafficRangeUsage([
      record(start + 20 * 60_000, 4_000, 8_000),
      record(end, 4_700, 8_600),
    ], start, end);

    expect(result).toMatchObject({
      up: 700,
      down: 600,
      total: 1_300,
      quality: "partial",
      coverageStart: start + 20 * 60_000,
      coverageEnd: end,
    });
  });

  it("handles counter resets without generating negative traffic", () => {
    const result = getTrafficRangeUsage([
      record(start - 60_000, 9_000, 2_000),
      record(start + 10 * 60_000, 100, 2_500),
      record(end, 500, 2_800),
    ], start, end);

    expect(result).toMatchObject({
      up: 500,
      down: 800,
      total: 1_300,
      quality: "partial",
    });
    expect(result.points.every((point) => point.up >= 0 && point.down >= 0)).toBe(true);
  });

  it("returns unavailable for an empty or invalid range", () => {
    expect(getTrafficRangeUsage([], start, end).quality).toBe("unavailable");
    expect(getTrafficRangeUsage([record(start, 100, 100)], end, start).quality).toBe("unavailable");
  });
});
