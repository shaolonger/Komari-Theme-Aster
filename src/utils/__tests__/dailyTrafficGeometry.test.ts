import { describe, expect, it } from "vitest";
import { dailyTrafficGeometry } from "@/utils/dailyTrafficGeometry";
import type { DailyTrafficPoint } from "@/utils/dailyTrafficTrend";
const day = (bytes: number | null): DailyTrafficPoint => ({ date: "2026-10-01", bytes, partial: false });

describe("daily traffic quota sparkline", () => {
  it("draws smooth filled segments without bridging missing days", () => {
    const result = dailyTrafficGeometry([day(1), day(3), day(null), day(2), day(4)]);
    expect(result).toHaveLength(2);
    expect(result[0].line).toContain(" C ");
    expect(result[0].area).toMatch(/ Z$/);
    expect(result[0].line).toMatch(/^M 0 /);
    expect(result[1].line).toMatch(/^M 75 /);
  });
  it("shows isolated samples as dots and draws no invented baseline for missing data", () => {
    expect(dailyTrafficGeometry([day(null), day(0), day(null)])).toEqual([{ line: "", area: "", point: { x: 50, y: 22 } }]);
    expect(dailyTrafficGeometry([day(null), day(null)])).toEqual([]);
  });
});
