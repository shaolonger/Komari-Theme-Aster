import { describe, expect, it } from "vitest";
import {
  getPingHistoryPointLimit,
  getPingHistoryQueryHours,
  getPingHistoryWindow,
} from "@/utils/pingHistoryResolution";

describe("Ping history resolution", () => {
  it("keeps short ranges compact while retaining a five-minute 7-day trend", () => {
    expect(getPingHistoryPointLimit(1)).toBe(160);
    expect(getPingHistoryPointLimit(24)).toBe(160);
    expect(getPingHistoryPointLimit(168)).toBe(2_016);
  });

  it("uses at least ten-minute precision for a month without exceeding the chart budget", () => {
    expect(getPingHistoryPointLimit(720)).toBe(4_320);
    expect(getPingHistoryPointLimit(24 * 90)).toBe(4_320);
  });

  it("queries the retained preset slice without changing an explicit range", () => {
    expect(getPingHistoryQueryHours(168, 24)).toBe(24);
    expect(getPingHistoryQueryHours(720, 24)).toBe(24);
    expect(getPingHistoryQueryHours(720, 24, true)).toBe(720);
    expect(getPingHistoryQueryHours(168, undefined)).toBe(168);
  });

  it("keeps the selected chart window even when only its tail has samples", () => {
    expect(getPingHistoryWindow({
      requestedHours: 168,
      responseEnd: 1_800_000,
      latestSample: 1_790_000,
    })).toEqual([1_195_200, 1_800_000]);
    expect(getPingHistoryWindow({
      requestedHours: 720,
      explicitStart: 1_000,
      explicitEnd: 2_000,
      responseEnd: 3_000,
    })).toEqual([1_000, 2_000]);
  });
});
