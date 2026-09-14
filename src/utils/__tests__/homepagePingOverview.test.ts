import { describe, expect, it } from "vitest";
import type { PingTask } from "@/types/komari";
import {
  aggregateHomepagePingOverviewItem,
  buildHomepagePingAssignmentKey,
  buildPingOverviewItemsForTask,
} from "@/utils/homepagePingOverview";

function task(partial: Partial<PingTask> & Pick<PingTask, "id">): PingTask {
  const { id, ...rest } = partial;
  return {
    id,
    interval: 60,
    name: "",
    loss: 0,
    clients: [],
    type: "icmp",
    target: "",
    weight: 0,
    ...rest,
  };
}

describe("buildHomepagePingAssignmentKey", () => {
  it("serializes multi-task bindings in stable node and task order", () => {
    const selected = new Map<string, number[]>([
      ["node-b", [12, 3]],
      ["node-a", [7]],
    ]);

    expect(buildHomepagePingAssignmentKey(selected)).toBe("node-a:7|node-b:3,12");
  });
});

describe("buildPingOverviewItemsForTask", () => {
  it("builds a single-task overview item with samples, loss and task metadata", () => {
    const items = buildPingOverviewItemsForTask(
      2,
      [
        { task_id: 2, client: "node-a", time: 1_000, value: 30 },
        { task_id: 2, client: "node-a", time: 2_000, value: 0 },
        { task_id: 9, client: "node-a", time: 3_000, value: 300 },
      ],
      task({ id: 2, name: "Cloudflare", target: "1.1.1.1" }),
    );

    expect(items.get("node-a")).toEqual({
      client: "node-a",
      isAssigned: true,
      lastValue: null,
      values: [30, 0],
      samples: [
        { time: 1_000_000, value: 30 },
        { time: 2_000_000, value: 0 },
      ],
      max: 30,
      loss: 50,
      taskIds: [2],
      taskCount: 1,
      taskSummaries: [
        {
          taskId: 2,
          name: "Cloudflare",
          target: "1.1.1.1",
          lastValue: null,
          loss: 50,
          sampleCount: 2,
          hasSamples: true,
          samples: [
            { time: 1_000_000, value: 30 },
            { time: 2_000_000, value: 0 },
          ],
        },
      ],
    });
  });
});

describe("aggregateHomepagePingOverviewItem", () => {
  it("merges samples and exposes worst-first latency and loss across tasks", () => {
    const task2Items = buildPingOverviewItemsForTask(
      2,
      [
        { task_id: 2, client: "node-a", time: 1_000, value: 20 },
        { task_id: 2, client: "node-a", time: 2_000, value: 40 },
      ],
      task({ id: 2, name: "Google", target: "8.8.8.8" }),
    );
    const task5Items = buildPingOverviewItemsForTask(
      5,
      [
        { task_id: 5, client: "node-a", time: 1_500, value: 0 },
        { task_id: 5, client: "node-a", time: 2_500, value: 180 },
      ],
      task({ id: 5, name: "Los Angeles", target: "15.253.0.254" }),
    );

    const item = aggregateHomepagePingOverviewItem({
      client: "node-a",
      taskIds: [5, 2],
      itemsByTask: new Map([
        [2, task2Items],
        [5, task5Items],
      ]),
      tasksById: new Map([
        [2, task({ id: 2, name: "Google", target: "8.8.8.8" })],
        [5, task({ id: 5, name: "Los Angeles", target: "15.253.0.254" })],
      ]),
    });

    expect(item.lastValue).toBe(180);
    expect(item.loss).toBe(50);
    expect(item.taskIds).toEqual([2, 5]);
    expect(item.taskCount).toBe(2);
    expect(item.samples).toEqual([
      { time: 1_000_000, value: 20 },
      { time: 1_500_000, value: 0 },
      { time: 2_000_000, value: 40 },
      { time: 2_500_000, value: 180 },
    ]);
    expect(item.taskSummaries).toEqual([
      expect.objectContaining({ taskId: 2, lastValue: 40, loss: 0, sampleCount: 2 }),
      expect.objectContaining({ taskId: 5, lastValue: 180, loss: 50, sampleCount: 2 }),
    ]);
  });

  it("keeps assigned nodes visible when all bound tasks have no samples", () => {
    const item = aggregateHomepagePingOverviewItem({
      client: "node-a",
      taskIds: [7, 3],
      itemsByTask: new Map(),
      tasksById: new Map([[3, task({ id: 3, name: "Edge" })]]),
    });

    expect(item).toMatchObject({
      client: "node-a",
      isAssigned: true,
      lastValue: null,
      values: [],
      samples: [],
      max: 1,
      loss: null,
      taskIds: [3, 7],
      taskCount: 2,
    });
    expect(item.taskSummaries).toEqual([
      expect.objectContaining({ taskId: 3, name: "Edge", hasSamples: false }),
      expect.objectContaining({ taskId: 7, name: "任务 #7", hasSamples: false }),
    ]);
  });

  it("can prioritize a configured primary task", () => {
    const task2Items = buildPingOverviewItemsForTask(2, [
      { task_id: 2, client: "node-a", time: 1_000, value: 20 },
    ]);
    const task5Items = buildPingOverviewItemsForTask(5, [
      { task_id: 5, client: "node-a", time: 1_000, value: 180 },
    ]);

    const item = aggregateHomepagePingOverviewItem({
      client: "node-a",
      taskIds: [2, 5],
      itemsByTask: new Map([
        [2, task2Items],
        [5, task5Items],
      ]),
      aggregationStrategy: "primary",
      primaryTaskId: 2,
    });

    expect(item.lastValue).toBe(20);
    expect(item.aggregationStrategy).toBe("primary");
    expect(item.primaryTaskId).toBe(2);
  });

  it("can average current latency and loss across available tasks", () => {
    const task2Items = buildPingOverviewItemsForTask(2, [
      { task_id: 2, client: "node-a", time: 1_000, value: 20 },
    ]);
    const task5Items = buildPingOverviewItemsForTask(5, [
      { task_id: 5, client: "node-a", time: 1_000, value: 0 },
      { task_id: 5, client: "node-a", time: 2_000, value: 80 },
    ]);

    const item = aggregateHomepagePingOverviewItem({
      client: "node-a",
      taskIds: [2, 5],
      itemsByTask: new Map([
        [2, task2Items],
        [5, task5Items],
      ]),
      aggregationStrategy: "average",
    });

    expect(item.lastValue).toBe(50);
    expect(item.loss).toBe(25);
  });
});
