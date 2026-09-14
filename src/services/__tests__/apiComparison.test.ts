import { describe, expect, it } from "vitest";
import { getComparisonRecordsMaxCount } from "@/services/api";

describe("comparison record limits", () => {
  it("keeps per-node comparison history bounded for long ranges", () => {
    expect(getComparisonRecordsMaxCount(720)).toBe(5_000);
  });

  it("keeps enough samples for short ranges", () => {
    expect(getComparisonRecordsMaxCount(1)).toBe(12);
    expect(getComparisonRecordsMaxCount(4)).toBe(48);
  });
});
