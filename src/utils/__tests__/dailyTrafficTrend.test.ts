import { describe, expect, it } from "vitest";
import type { LoadRecord } from "@/types/komari";
import { buildDailyTrafficTrend } from "@/utils/dailyTrafficTrend";

const record = (date: string, up: number, down: number) => ({ time: date, net_total_up: up, net_total_down: down }) as LoadRecord;
const now = Date.parse("2026-10-29T12:00:00Z");

describe("daily traffic trend", () => {
  it("uses observed same-day differences, marks incomplete days and does not invent gap data", () => {
    const trend = buildDailyTrafficTrend([
      record("2026-10-28T23:00:00Z", 100, 200),
      record("2026-10-29T01:00:00Z", 200, 300),
      record("2026-10-29T02:00:00Z", 220, 330),
      record("2026-10-29T10:00:00Z", 400, 500),
    ], now, "UTC");
    expect(trend.days).toHaveLength(32);
    expect(trend.days.at(-1)).toEqual({ date: "2026-10-29", bytes: 50, partial: true });
    expect(trend.days.at(-2)?.bytes).toBeNull();
  });

  it("does not count counter reset intervals and respects the selected timezone", () => {
    const trend = buildDailyTrafficTrend([
      record("2026-10-29T01:00:00Z", 100, 200),
      record("2026-10-29T02:00:00Z", 10, 250),
      record("2026-10-29T03:00:00Z", 20, 270),
    ], now, "America/Los_Angeles");
    expect(trend.days.at(-2)).toEqual({ date: "2026-10-28", bytes: 30, partial: true });
    expect(trend.days.at(-1)?.bytes).toBeNull();
  });

  it("preserves zero usage and treats a single point as unavailable", () => {
    const trend = buildDailyTrafficTrend([
      record("2026-10-29T01:00:00Z", 0, 0),
      record("2026-10-29T02:00:00Z", 0, 0),
    ], now, "UTC");
    expect(trend.days.at(-1)?.bytes).toBe(0);
    expect(buildDailyTrafficTrend([record("2026-10-29T01:00:00Z", 0, 0)], now, "UTC").days.at(-1)?.bytes).toBeNull();
  });
});

describe("tentative cycle boundaries", () => {
  it("starts at the latest observed simultaneous counter drop and excludes the pre-reset interval", () => {
    const trend = buildDailyTrafficTrend([
      record("2026-10-26T20:00:00Z", 100, 200),
      record("2026-10-27T01:00:00Z", 300, 400),
      record("2026-10-27T02:00:00Z", 10, 20),
      record("2026-10-27T03:00:00Z", 30, 50),
      record("2026-10-28T01:00:00Z", 80, 90),
      record("2026-10-28T02:00:00Z", 100, 120),
    ], now, "UTC");
    expect(trend.resetObservedAt).toBe(Date.parse("2026-10-27T02:00:00Z"));
    expect(trend.days.map((day) => day.date)).toEqual(["2026-10-27", "2026-10-28", "2026-10-29"]);
    expect(trend.days[0]).toMatchObject({ bytes: 50, partial: true });
  });
  it("does not infer a reset across a long gap or from one counter increasing", () => {
    const trend = buildDailyTrafficTrend([
      record("2026-10-26T00:00:00Z", 100, 200),
      record("2026-10-27T00:00:00Z", 1, 2),
      record("2026-10-27T01:00:00Z", 0, 100),
    ], now, "UTC");
    expect(trend.resetObservedAt).toBeNull();
    expect(trend.days).toHaveLength(32);
  });
});
