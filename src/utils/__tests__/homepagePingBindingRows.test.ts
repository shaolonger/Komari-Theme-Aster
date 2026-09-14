import { describe, expect, it } from "vitest";
import type { AdminClient, PingTask } from "@/types/komari";
import { buildHomepagePingClientBindingRows } from "@/utils/homepagePingBindingRows";

function client(partial: Partial<AdminClient> & Pick<AdminClient, "uuid">): AdminClient {
  const { uuid, ...rest } = partial;
  return {
    uuid,
    name: uuid,
    group: "",
    region: "",
    weight: 0,
    version: "",
    ipv4: "",
    ipv6: "",
    capability_ping: null,
    capability_private_ping_targets: null,
    ...rest,
  };
}

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

describe("buildHomepagePingClientBindingRows", () => {
  it("builds VPS-first rows with primary task and task groups", () => {
    const rows = buildHomepagePingClientBindingRows({
      clients: [client({ uuid: "a", name: "alpha" }), client({ uuid: "b", name: "beta" })],
      tasks: [task({ id: 2, name: "Google" }), task({ id: 5, name: "Cloudflare" })],
      bindings: { 5: ["a"], 2: ["a", "b"] },
      primaryTasks: { a: 5, b: 5 },
      taskGroups: { 5: "海外", 2: "公共" },
    });

    expect(rows).toEqual([
      expect.objectContaining({
        uuid: "a",
        taskIds: [2, 5],
        taskCount: 2,
        primaryTaskId: 5,
        tasks: [
          { taskId: 2, name: "Google", group: "公共" },
          { taskId: 5, name: "Cloudflare", group: "海外" },
        ],
      }),
      expect.objectContaining({
        uuid: "b",
        taskIds: [2],
        primaryTaskId: null,
      }),
    ]);
  });
});
