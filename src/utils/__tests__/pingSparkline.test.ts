import { describe, expect, it } from "vitest";
import { buildPingSparklineGeometry } from "@/utils/pingSparkline";

function hourlySamples(lossIndexes: number[] = []) {
  const losses = new Set(lossIndexes);
  return Array.from({ length: 60 }, (_, index) => ({
    time: index * 60_000,
    value: losses.has(index) ? 0 : 150 + Math.sin(index / 4) * 10,
  }));
}

describe("buildPingSparklineGeometry", () => {
  it("keeps packet loss from the full one-hour window, not only the latest samples", () => {
    const geometry = buildPingSparklineGeometry(hourlySamples([5]));

    expect(geometry.lossMarkers).toHaveLength(1);
    expect(geometry.lossMarkers[0]).toBeLessThan(20);
    expect(geometry.paths.length).toBeGreaterThanOrEqual(2);
  });

  it("preserves loss events while decimating a dense sample series", () => {
    const samples = Array.from({ length: 3_600 }, (_, index) => ({
      time: index * 1_000,
      value: index === 120 || index === 3_200 ? 0 : 30 + (index % 20),
    }));
    const geometry = buildPingSparklineGeometry(samples, { maxPoints: 80 });

    expect(geometry.lossMarkers).toHaveLength(2);
    expect(geometry.paths.length).toBeGreaterThanOrEqual(3);
  });

  it("insets first and last loss markers so card clipping cannot hide them", () => {
    const geometry = buildPingSparklineGeometry(hourlySamples([0, 59]));

    expect(geometry.lossMarkers).toEqual([1, 99]);
  });
});
