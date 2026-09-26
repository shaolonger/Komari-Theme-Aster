import { describe, expect, it } from "vitest";
import { getHostHealthStatus, getNetworkHealthStatus } from "../NodeStatusSummary";

describe("node health status layers", () => {
  it("keeps host health independent from ping task status", () => {
    expect(getHostHealthStatus(true, 10_000, 20_000)).toBe("online");
    expect(getNetworkHealthStatus([{ status: "critical" }], true)).toBe("critical");
  });

  it("distinguishes offline and stale reporting from a healthy host", () => {
    expect(getHostHealthStatus(false, 20_000, 30_000)).toBe("offline");
    expect(getHostHealthStatus(true, 20_000, 20_000 + 181_000)).toBe("stale");
    expect(getHostHealthStatus(true, 0, 20_000)).toBe("stale");
  });

  it("labels missing monitoring separately from network faults", () => {
    expect(getNetworkHealthStatus([], false)).toBe("unmonitored");
    expect(getNetworkHealthStatus([], true)).toBe("empty");
    expect(getNetworkHealthStatus([{ status: "warning" }], true)).toBe("warning");
    expect(getNetworkHealthStatus([{ status: "ok" }], true)).toBe("ok");
  });
});
