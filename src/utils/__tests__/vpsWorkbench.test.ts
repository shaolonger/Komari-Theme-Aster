import { describe, expect, it, vi } from "vitest";
import type { NodeInfo, PingOverviewItem } from "@/types/komari";
import {
  buildVpsWorkbenchNode,
  getConfigCompleteness,
  getExpiryBucket,
  getPingHealth,
  getTrafficForecast,
  sortWorkbenchNodes,
  summarizeWorkbench,
} from "@/utils/vpsWorkbench";

const NOW = Date.UTC(2026, 5, 28, 12, 0, 0);

function inDays(days: number) {
  return new Date(NOW + days * 86400_000).toISOString();
}

function node(partial: Partial<NodeInfo> = {}): NodeInfo {
  return {
    uuid: "node-a",
    name: "Node A",
    group: "prod",
    region: "HK",
    hidden: false,
    cpu_name: "",
    cpu_cores: 1,
    arch: "amd64",
    virtualization: "",
    os: "linux",
    kernel_version: "",
    version: "v1.2.4",
    ipv4: "",
    ipv6: "",
    capability_ping: true,
    capability_private_ping_targets: false,
    gpu_name: "",
    mem_total: 0,
    swap_total: 0,
    disk_total: 0,
    weight: 0,
    price: 10,
    billing_cycle: "30",
    auto_renewal: false,
    currency: "USD",
    expired_at: inDays(20),
    tags: "",
    public_remark: "",
    traffic_limit: 100,
    traffic_limit_type: "sum",
    created_at: "",
    updated_at: "",
    ...partial,
  };
}

function ping(partial: Partial<PingOverviewItem> = {}): PingOverviewItem {
  return {
    client: "node-a",
    isAssigned: true,
    lastValue: 42,
    values: [40, 42],
    samples: [],
    max: 42,
    loss: 0,
    ...partial,
  };
}

describe("getConfigCompleteness", () => {
  it("ignores admin-only agent version when only public metadata is available", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const result = getConfigCompleteness(
      node({
        group: "",
        price: 0,
        billing_cycle: "",
        expired_at: "",
        traffic_limit: 0,
        version: "",
      }),
      false,
    );

    expect(result.complete).toBe(1);
    expect(result.total).toBe(7);
    expect(result.missing.map((item) => item.key)).toEqual([
      "group",
      "price",
      "billing",
      "expiry",
      "traffic",
      "ping",
    ]);
    vi.useRealTimers();
  });

  it("tracks agent version when authenticated metadata is available", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const result = getConfigCompleteness(
      node({
        version: "",
      }),
      true,
      { includeAgentVersion: true },
    );

    expect(result.total).toBe(8);
    expect(result.missing.map((item) => item.key)).toEqual(["agent"]);
    vi.useRealTimers();
  });
});

describe("expiry and traffic", () => {
  it("buckets expiry dates", () => {
    expect(getExpiryBucket(null)).toBe("unknown");
    expect(getExpiryBucket(-1)).toBe("expired");
    expect(getExpiryBucket(7)).toBe("soon");
    expect(getExpiryBucket(30)).toBe("month");
    expect(getExpiryBucket(31)).toBe("later");
  });

  it("estimates traffic exhaustion from the current matching rate", () => {
    const forecast = getTrafficForecast({
      trafficLimitType: "sum",
      trafficUp: 80,
      trafficDown: 10,
      netUp: 1,
      netDown: 1,
      trafficLimit: 100,
    });

    expect(forecast.status).toBe("critical");
    expect(forecast.remaining).toBe(10);
    expect(forecast.burnRate).toBe(2);
    expect(forecast.exhaustInSeconds).toBe(5);
  });

  it("keeps unlimited nodes out of traffic pressure", () => {
    expect(
      getTrafficForecast({
        trafficLimitType: "max",
        trafficUp: 100,
        trafficDown: 200,
        netUp: 100,
        netDown: 100,
        trafficLimit: 0,
      }).status,
    ).toBe("unlimited");
  });
});

describe("getPingHealth", () => {
  it("explains common Ping states", () => {
    expect(getPingHealth({ hasPingBinding: false, capabilityPing: true }).state).toBe("unbound");
    expect(getPingHealth({ hasPingBinding: true, capabilityPing: false }).state).toBe("disabled");
    expect(
      getPingHealth({
        hasPingBinding: true,
        capabilityPing: true,
        ping: ping({ values: [] }),
      }).state,
    ).toBe("no-data");
    expect(
      getPingHealth({
        hasPingBinding: true,
        capabilityPing: true,
        ping: ping({ loss: 21.345 }),
      }),
    ).toMatchObject({ state: "critical", detail: "丢包 21.35%" });
    expect(
      getPingHealth({
        hasPingBinding: true,
        capabilityPing: true,
        ping: ping({ lastValue: 300.345 }),
      }),
    ).toMatchObject({ state: "warning", detail: "300.35 ms" });
  });
});

describe("workbench node sorting and summary", () => {
  it("sorts incomplete nodes first and summarizes pressure", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const full = buildVpsWorkbenchNode({
      meta: node({ uuid: "full", name: "Full", weight: 2, expired_at: inDays(60) }),
      online: true,
      updatedAt: NOW,
      trafficUp: 1,
      trafficDown: 1,
      netUp: 0,
      netDown: 0,
      hasPingBinding: true,
      ping: ping(),
      now: NOW,
    });
    const incomplete = buildVpsWorkbenchNode({
      meta: node({
        uuid: "miss",
        name: "Missing",
        weight: 1,
        group: "",
        expired_at: inDays(2),
        capability_ping: false,
      }),
      online: true,
      updatedAt: NOW,
      trafficUp: 95,
      trafficDown: 0,
      netUp: 1,
      netDown: 0,
      hasPingBinding: true,
      now: NOW,
    });

    expect(sortWorkbenchNodes([full, incomplete], "completeness").map((item) => item.uuid)).toEqual([
      "miss",
      "full",
    ]);
    expect(summarizeWorkbench([full, incomplete])).toMatchObject({
      total: 2,
      incomplete: 1,
      dueSoon: 1,
      trafficPressure: 1,
      pingAttention: 1,
    });
    vi.useRealTimers();
  });
});
