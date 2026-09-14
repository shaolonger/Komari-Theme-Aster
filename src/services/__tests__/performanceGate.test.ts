import { describe, expect, it } from "vitest";
import { runRealtimeScaleFixture } from "@/services/wsStore";

describe("realtime release performance gates", () => {
  it("processes a 30-node full delta below the 8 ms budget", () => {
    runRealtimeScaleFixture(30, 5);
    const result = runRealtimeScaleFixture(30, 50);
    expect(result.elapsedMs / result.ticks).toBeLessThan(8);
    expect(result.nodeCount).toBe(30);
    expect(result.maxTrendSamples).toBe(36);
  });

  it.each([
    [30, 8],
    [300, 45],
    [1_000, 180],
  ])("keeps a %i-node snapshot inside the scale budget", (nodes, maxMs) => {
    const result = runRealtimeScaleFixture(nodes, 1);
    expect(result.elapsedMs).toBeLessThan(maxMs);
    expect(result.checksum).toBeGreaterThan(0);
  });

  it("keeps every traffic series bounded through a 30-minute accelerated soak", () => {
    const result = runRealtimeScaleFixture(30, 1_800);
    expect(result.maxTrendSamples).toBe(36);
    expect(result.retainedTrendSamples).toBe(30 * 36);
    expect(result.retainedMetricNodes).toBe(30);
    expect(result.elapsedMs).toBeLessThan(8_000);
  });

  it("keeps retained heap cardinality flat after the ring buffers fill", () => {
    const filled = runRealtimeScaleFixture(30, 18);
    const soaked = runRealtimeScaleFixture(30, 1_800);
    expect(soaked.retainedTrendSamples).toBe(filled.retainedTrendSamples);
    expect(soaked.retainedMetricNodes).toBe(filled.retainedMetricNodes);
  });
});
