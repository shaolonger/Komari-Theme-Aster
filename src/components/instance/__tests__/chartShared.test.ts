import { describe, expect, it } from "vitest";
import { buildPingTimeRangeOptions } from "@/components/instance/chartShared";

describe("Ping time range options", () => {
  it("keeps the 7-day and 1-month controls visible with short advertised retention", () => {
    expect(buildPingTimeRangeOptions(24).map((option) => option.label)).toEqual([
      "1 小时",
      "6 小时",
      "1 天",
      "7 天",
      "1 月",
    ]);
  });
});
