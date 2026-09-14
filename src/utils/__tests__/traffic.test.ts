import { describe, expect, it } from "vitest";
import {
  computeTrafficUsed,
  formatCompactTrafficDetail,
  resolveTrafficUsage,
  trafficTypeLabel,
} from "@/utils/traffic";

describe("computeTrafficUsed", () => {
  it("reduces up/down per type", () => {
    expect(computeTrafficUsed("sum", 30, 70)).toBe(100);
    expect(computeTrafficUsed("up", 30, 70)).toBe(30);
    expect(computeTrafficUsed("down", 30, 70)).toBe(70);
    expect(computeTrafficUsed("max", 30, 70)).toBe(70);
    expect(computeTrafficUsed("min", 30, 70)).toBe(30);
  });

  it("defaults to max for empty/unknown (backend gorm default)", () => {
    expect(computeTrafficUsed("", 30, 70)).toBe(70);
    expect(computeTrafficUsed(undefined, 80, 20)).toBe(80);
    expect(computeTrafficUsed(null, 80, 20)).toBe(80);
    expect(computeTrafficUsed("weird", 80, 20)).toBe(80);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(computeTrafficUsed(" SUM ", 30, 70)).toBe(100);
    expect(computeTrafficUsed("Up", 30, 70)).toBe(30);
  });

  it("guards NaN/negative inputs to 0", () => {
    expect(computeTrafficUsed("sum", Number.NaN, 70)).toBe(70);
    expect(computeTrafficUsed("sum", -5, 70)).toBe(70);
    expect(computeTrafficUsed("min", -5, 70)).toBe(0);
  });
});

describe("resolveTrafficUsage", () => {
  it("derives used/remaining/fraction from a limit", () => {
    const usage = resolveTrafficUsage("sum", 30, 70, 200);
    expect(usage.used).toBe(100);
    expect(usage.limit).toBe(200);
    expect(usage.unlimited).toBe(false);
    expect(usage.remaining).toBe(100);
    expect(usage.fraction).toBe(0.5);
  });

  it("reduces by type before measuring against the limit", () => {
    expect(resolveTrafficUsage("max", 30, 70, 200).used).toBe(70);
    expect(resolveTrafficUsage("up", 30, 70, 200).used).toBe(30);
  });

  it("treats limit <= 0 as unlimited", () => {
    const usage = resolveTrafficUsage("sum", 30, 70, 0);
    expect(usage.unlimited).toBe(true);
    expect(usage.remaining).toBe(0);
    expect(usage.fraction).toBe(0);
  });

  it("clamps fraction and remaining when over the limit", () => {
    const usage = resolveTrafficUsage("sum", 150, 100, 200);
    expect(usage.used).toBe(250);
    expect(usage.fraction).toBe(1);
    expect(usage.remaining).toBe(0);
  });
});

describe("formatCompactTrafficDetail", () => {
  it("shares a single unit between used and limit values", () => {
    expect(
      formatCompactTrafficDetail(
        resolveTrafficUsage("sum", 1.79 * 1024 ** 3, 0, 500 * 1024 ** 3),
      ),
    ).toBe("1.79/500 GB");
  });

  it("keeps natural units when used and limit sizes differ", () => {
    expect(
      formatCompactTrafficDetail(
        resolveTrafficUsage("sum", 22 * 1024 ** 3, 0, 2 * 1024 ** 4),
      ),
    ).toBe("22 GB/2 TB");
  });

  it("does not expand a GB limit into an unreadable MB denominator", () => {
    expect(
      formatCompactTrafficDetail(
        resolveTrafficUsage("sum", 8.05 * 1024 ** 2, 0, 500 * 1024 ** 3),
      ),
    ).toBe("8.05 MB/500 GB");
  });

  it("keeps very small usage readable beside a much larger limit", () => {
    expect(
      formatCompactTrafficDetail(
        resolveTrafficUsage("sum", 512, 0, 500 * 1024 ** 3),
      ),
    ).toBe("512 B/500 GB");
  });

  it("keeps unlimited usage concise", () => {
    expect(
      formatCompactTrafficDetail(
        resolveTrafficUsage("sum", 2.73 * 1024 ** 3, 0, 0),
      ),
    ).toBe("2.73 GB/∞");
  });
});

describe("trafficTypeLabel", () => {
  it("labels each known type", () => {
    expect(trafficTypeLabel("up")).toBe("仅上行");
    expect(trafficTypeLabel("down")).toBe("仅下行");
    expect(trafficTypeLabel("sum")).toBe("上行+下行");
    expect(trafficTypeLabel("min")).toBe("上下取小");
    expect(trafficTypeLabel("max")).toBe("上下取大");
  });

  it("falls back to max label for empty/unknown", () => {
    expect(trafficTypeLabel("")).toBe("上下取大");
    expect(trafficTypeLabel(undefined)).toBe("上下取大");
  });
});
