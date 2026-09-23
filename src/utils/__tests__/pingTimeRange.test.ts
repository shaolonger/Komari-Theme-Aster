import { describe, expect, it } from "vitest";
import { previousEveningInZone, resolveRangeInZone } from "../pingTimeRange";
import { normalizeHomepagePingTaskOrder } from "../pingTasks";

describe("custom Ping range", () => {
  it("defaults to the previous evening in the selected time zone", () => {
    const draft = previousEveningInZone(Date.parse("2026-01-01T17:00:00Z"), "Asia/Shanghai");
    expect(draft).toEqual({ start: "2026-01-01T18:00", end: "2026-01-02T00:00" });
    expect(resolveRangeInZone(draft, "Asia/Shanghai")).toEqual({ start: "2026-01-01T10:00:00.000Z", end: "2026-01-01T16:00:00.000Z" });
    expect(previousEveningInZone(Date.parse("2026-01-01T17:00:00Z"), "America/Los_Angeles"))
      .toEqual({ start: "2025-12-31T18:00", end: "2026-01-01T00:00" });
  });
  it("rejects reversed and invalid ranges", () => {
    expect(resolveRangeInZone({ start: "", end: "" }, "Asia/Shanghai")).toBeNull();
    expect(resolveRangeInZone({ start: "2026-01-02T00:00", end: "2026-01-01T00:00" }, "Asia/Shanghai")).toBeNull();
  });
});

describe("per VPS Ping order", () => {
  it("keeps independent explicit orders and migrates older bindings", () => {
    const bindings = { 1: ["a", "b"], 2: ["a", "b"], 3: ["a"] };
    expect(normalizeHomepagePingTaskOrder({ a: [3, 1, 3, 99], b: [2, 1] }, bindings)).toEqual({ a: [3, 1, 2], b: [2, 1] });
    expect(normalizeHomepagePingTaskOrder(undefined, bindings)).toEqual({ a: [1, 2, 3], b: [1, 2] });
  });
});
