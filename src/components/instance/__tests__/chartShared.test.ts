import { describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";
import {
  buildChartTooltipHooks,
  buildLoadTimeRangeOptions,
  buildPingTimeRangeOptions,
  buildTrafficTimeRangeOptions,
  type ChartTooltipState,
} from "@/components/instance/chartShared";

describe("Ping time range options", () => {
  it("normalizes 30-day and 31-day retention into one 1-month load option", () => {
    expect(buildLoadTimeRangeOptions(744).map((option) => option.label)).toEqual([
      "实时",
      "1 小时",
      "6 小时",
      "1 天",
      "7 天",
      "1 月",
    ]);
  });

  it("does not append a duplicate 31-day Ping option", () => {
    expect(buildPingTimeRangeOptions(744).map((option) => option.label)).toEqual([
      "1 小时",
      "6 小时",
      "1 天",
      "7 天",
      "1 月",
    ]);
  });

  it("keeps the 7-day and 1-month controls visible with short advertised retention", () => {
    expect(buildPingTimeRangeOptions(24).map((option) => option.label)).toEqual([
      "1 小时",
      "6 小时",
      "1 天",
      "7 天",
      "1 月",
    ]);
  });

  it("offers fixed traffic windows and the configured retention window", () => {
    expect(buildTrafficTimeRangeOptions(36)).toEqual([
      { label: "1 小时", value: 1 },
      { label: "6 小时", value: 6 },
      { label: "1 天", value: 24 },
      { label: "36 小时", value: 36 },
      { label: "7 天", value: 168 },
      { label: "1 月", value: 720 },
    ]);
  });

  it("reads the timestamp and rows from the uPlot instance that fired the cursor hook", () => {
    let tooltip: ChartTooltipState = { show: false, left: 0, top: 0, rows: [], time: "" };
    const currentData = [[100, 200], [10, 20]] as uPlot.AlignedData;
    const buildRows = vi.fn((idx: number, data: uPlot.AlignedData) => [{
      label: "Edge",
      value: String(data[1]?.[idx]),
      color: "blue",
    }]);
    const hooks = buildChartTooltipHooks({
      rangeHours: 1,
      displayTimeZone: "UTC",
      estimatedWidth: 180,
      setTooltip: (next) => {
        tooltip = typeof next === "function" ? next(tooltip) : next;
      },
      buildRows,
    });
    const plot = {
      data: currentData,
      cursor: { idx: 1, left: 20, top: 30 },
      root: { getBoundingClientRect: () => ({ width: 600, height: 300 }) },
      valToPos: (value: number) => value / 10,
    } as unknown as uPlot;

    hooks.onSetCursor(plot);

    expect(buildRows).toHaveBeenCalledWith(1, currentData);
    expect(tooltip).toMatchObject({ show: true, time: "00:03:20" });
    expect(tooltip.rows[0]?.value).toBe("20");
  });

  it("does not snap an empty long-range area to one distant retained point", () => {
    let tooltip: ChartTooltipState = { show: true, left: 0, top: 0, rows: [], time: "old" };
    const hooks = buildChartTooltipHooks({
      rangeHours: 720,
      displayTimeZone: "UTC",
      estimatedWidth: 180,
      maxSnapDistancePx: 28,
      setTooltip: (next) => {
        tooltip = typeof next === "function" ? next(tooltip) : next;
      },
      buildRows: () => [],
    });
    const plot = {
      data: [[1_700_000_000], [20]] as uPlot.AlignedData,
      cursor: { idx: 0, left: 300, top: 30 },
      root: { getBoundingClientRect: () => ({ width: 600, height: 300 }) },
      valToPos: () => 580,
    } as unknown as uPlot;

    hooks.onSetCursor(plot);

    expect(tooltip.show).toBe(false);
  });
});
