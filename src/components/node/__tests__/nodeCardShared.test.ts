import { describe, expect, it } from "vitest";
import { pingTaskAggregateLabels } from "@/components/node/nodeCardShared";

describe("pingTaskAggregateLabels", () => {
  it("returns no badge for a single source", () => {
    expect(
      pingTaskAggregateLabels({
        taskCount: 1,
        taskSummaries: [
          {
            taskId: 1,
            name: "Google",
            target: "8.8.8.8",
            lastValue: 42,
            loss: 0,
            sampleCount: 12,
            hasSamples: true,
          },
        ],
      }),
    ).toEqual({
      badge: null,
      title: "Google / 8.8.8.8 (42.00 ms，丢包 0.00%)",
    });
  });

  it("surfaces multi-source aggregation details for node card titles", () => {
    const labels = pingTaskAggregateLabels({
      taskCount: 2,
      taskSummaries: [
        {
          taskId: 1,
          name: "Google",
          target: "8.8.8.8",
          lastValue: 42,
          loss: 0,
          sampleCount: 12,
          hasSamples: true,
        },
        {
          taskId: 2,
          name: "洛杉矶",
          target: "15.253.0.254",
          lastValue: 180,
          loss: 2.5,
          sampleCount: 12,
          hasSamples: true,
        },
      ],
    });

    expect(labels.badge).toBe("2源");
    expect(labels.title).toContain("由 2 个首页 Ping 任务聚合");
    expect(labels.title).toContain("Google / 8.8.8.8");
    expect(labels.title).toContain("洛杉矶 / 15.253.0.254");
  });
});
