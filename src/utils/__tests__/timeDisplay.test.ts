import { describe, expect, it } from "vitest";
import {
  SYSTEM_DISPLAY_TIME_ZONE,
  formatAxisTime,
  formatChartCoverageTime,
  formatDateTimeLocalValue,
  formatExportRangeToken,
  formatTooltipTime,
  normalizeDisplayTimeZone,
  parseDateTimeLocalInZone,
} from "@/utils/timeDisplay";

describe("display time zone helpers", () => {
  it("normalizes invalid or empty display time zones back to system", () => {
    expect(normalizeDisplayTimeZone(undefined)).toBe(SYSTEM_DISPLAY_TIME_ZONE);
    expect(normalizeDisplayTimeZone("")).toBe(SYSTEM_DISPLAY_TIME_ZONE);
    expect(normalizeDisplayTimeZone("system")).toBe(SYSTEM_DISPLAY_TIME_ZONE);
    expect(normalizeDisplayTimeZone("Not/A_Zone")).toBe(SYSTEM_DISPLAY_TIME_ZONE);
  });

  it("keeps valid IANA zones and formats chart labels in that zone", () => {
    expect(normalizeDisplayTimeZone("Asia/Shanghai")).toBe("Asia/Shanghai");
    expect(formatAxisTime(0, 1, "UTC")).toBe("00:00");
    expect(formatAxisTime(0, 1, "Asia/Shanghai")).toBe("08:00");
    expect(formatTooltipTime(0, 24, "Asia/Shanghai")).toBe("1970-01-01 08:00:00");
    expect(formatChartCoverageTime(0, "America/Los_Angeles")).toBe("12/31 16:00");
  });

  it("round-trips datetime-local values through the selected display zone", () => {
    expect(formatDateTimeLocalValue(0, "Asia/Shanghai")).toBe("1970-01-01T08:00");
    expect(parseDateTimeLocalInZone("1970-01-01T08:00", "Asia/Shanghai")).toBe(0);
    expect(parseDateTimeLocalInZone("1969-12-31T16:00", "America/Los_Angeles")).toBe(0);
  });

  it("formats export range tokens in the selected display zone", () => {
    expect(formatExportRangeToken(0, 3_600, "Asia/Shanghai")).toBe(
      "197001010800-197001010900",
    );
  });
});
