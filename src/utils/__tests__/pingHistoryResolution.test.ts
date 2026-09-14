import { describe, expect, it } from "vitest";
import { getPingHistoryPointLimit } from "@/utils/pingHistoryResolution";

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
});
