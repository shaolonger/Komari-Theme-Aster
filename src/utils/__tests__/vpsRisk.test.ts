import { describe, expect, it } from "vitest";
import { getVpsOperationalRisks, STALE_REPORT_MS } from "@/utils/vpsRisk";

const NOW = Date.UTC(2026, 5, 27, 12, 0, 0);

function inDays(days: number) {
  return new Date(NOW + days * 24 * 60 * 60 * 1000).toISOString();
}

function baseInput() {
  return {
    uuid: "node-1",
    online: true,
    updatedAt: NOW,
    trafficUp: 0,
    trafficDown: 0,
    trafficLimit: 0,
    trafficLimitType: "max",
    expiredAt: "",
    capabilityPing: null,
    hasPingBinding: false,
    now: NOW,
  };
}

describe("getVpsOperationalRisks", () => {
  it("flags offline nodes before stale-report checks", () => {
    const risks = getVpsOperationalRisks({
      ...baseInput(),
      online: false,
      updatedAt: NOW - STALE_REPORT_MS * 2,
    });

    expect(risks).toEqual([
      expect.objectContaining({
        kind: "status",
        severity: "critical",
        title: "节点离线",
      }),
    ]);
  });

  it("flags online nodes with stale reports", () => {
    const risks = getVpsOperationalRisks({
      ...baseInput(),
      updatedAt: NOW - STALE_REPORT_MS - 60_000,
    });

    expect(risks).toEqual([
      expect.objectContaining({
        kind: "status",
        severity: "warning",
        title: "上报延迟",
      }),
    ]);
  });

  it("flags upcoming and expired VPS dates", () => {
    expect(
      getVpsOperationalRisks({
        ...baseInput(),
        expiredAt: inDays(12),
      }),
    ).toEqual([
      expect.objectContaining({
        kind: "expiry",
        severity: "warning",
      }),
    ]);

    expect(
      getVpsOperationalRisks({
        ...baseInput(),
        expiredAt: inDays(2),
      }),
    ).toEqual([
      expect.objectContaining({
        kind: "expiry",
        severity: "critical",
      }),
    ]);
  });

  it("flags high traffic usage after applying the configured usage type", () => {
    const risks = getVpsOperationalRisks({
      ...baseInput(),
      trafficUp: 30,
      trafficDown: 70,
      trafficLimit: 100,
      trafficLimitType: "sum",
    });

    expect(risks).toEqual([
      expect.objectContaining({
        kind: "traffic",
        severity: "critical",
        title: "流量已用尽",
      }),
    ]);
  });

  it("flags bound Ping tasks only when Ping capability is explicitly disabled", () => {
    expect(
      getVpsOperationalRisks({
        ...baseInput(),
        hasPingBinding: true,
        capabilityPing: null,
      }),
    ).toEqual([]);

    expect(
      getVpsOperationalRisks({
        ...baseInput(),
        hasPingBinding: true,
        capabilityPing: false,
      }),
    ).toEqual([
      expect.objectContaining({
        kind: "ping",
        severity: "warning",
      }),
    ]);
  });
});
