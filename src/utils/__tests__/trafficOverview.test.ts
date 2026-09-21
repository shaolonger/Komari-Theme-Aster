import { describe, expect, it } from "vitest";
import { buildHomeTrafficOverview, getHomeTrafficPeriodStart } from "@/utils/trafficOverview";

const NOW = new Date(2026, 5, 28, 12, 0, 0, 0).getTime();

describe("home traffic overview", () => {
  it("calculates today and month traffic from cumulative counters", () => {
    const todayStart = getHomeTrafficPeriodStart("today", NOW);
    const monthStart = getHomeTrafficPeriodStart("month", NOW);
    const rows = buildHomeTrafficOverview(
      [{
        uuid: "node-a",
        name: "Node A",
        group: "prod",
        region: "HK",
    online: true,
    updatedAt: 1_700_000_000_000,
        netUp: 100,
        netDown: 50,
        trafficUp: 1_500,
        trafficDown: 2_000,
        expiredAt: "",
      }],
      {
        "node-a": [
          { time: monthStart - 1_000, net_total_up: 300, net_total_down: 600 } as never,
          { time: todayStart - 1_000, net_total_up: 1_000, net_total_down: 1_500 } as never,
          { time: NOW - 1_000, net_total_up: 1_400, net_total_down: 1_900 } as never,
        ],
      },
      NOW,
    );

    expect(rows[0]?.today).toEqual({ up: 500, down: 500, total: 1_000 });
    expect(rows[0]?.month).toEqual({ up: 1_200, down: 1_400, total: 2_600 });
    expect(rows[0]?.total).toEqual({ up: 1_500, down: 2_000, total: 3_500 });
  });

  it("treats a counter reset as usage since the reset", () => {
    const rows = buildHomeTrafficOverview(
      [{
        uuid: "node-a",
        name: "Node A",
        group: "",
        region: "",
    online: true,
    updatedAt: 1_700_000_000_000,
        netUp: 20,
        netDown: 8,
        trafficUp: 20,
        trafficDown: 8,
        expiredAt: "",
      }],
      {
        "node-a": [
          { time: NOW - 60_000, net_total_up: 900, net_total_down: 700 } as never,
          { time: NOW - 1_000, net_total_up: 10, net_total_down: 4 } as never,
        ],
      },
      NOW,
    );

    expect(rows[0]?.today).toEqual({ up: 20, down: 8, total: 28 });
  });
});
