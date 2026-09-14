import { describe, expect, it } from "vitest";
import {
  countHomepagePingBindingPairs,
  countHomepagePingBoundClients,
  filterHomepagePingTaskBindings,
  getHomepagePingTaskIdsByClient,
  invertHomepagePingTaskBindings,
  normalizeHomepagePingTaskBindings,
} from "@/utils/pingTasks";

describe("normalizeHomepagePingTaskBindings", () => {
  it("keeps valid task bindings and removes invalid or duplicated clients", () => {
    expect(
      normalizeHomepagePingTaskBindings({
        2: [" node-a ", "node-a", "node-b", "", null],
        0: ["ignored"],
        abc: ["ignored"],
        4: "node-c",
        6: ["node-c"],
      }),
    ).toEqual({
      2: ["node-a", "node-b"],
      6: ["node-c"],
    });
  });
});

describe("invertHomepagePingTaskBindings", () => {
  it("preserves the legacy first-task-per-client behavior", () => {
    const inverted = invertHomepagePingTaskBindings({
      12: ["node-a", "node-b"],
      5: ["node-a"],
      9: ["node-c", "node-b"],
    });

    expect(Array.from(inverted.entries())).toEqual([
      ["node-a", 5],
      ["node-c", 9],
      ["node-b", 9],
    ]);
  });
});

describe("filterHomepagePingTaskBindings", () => {
  it("removes bindings for Ping tasks no longer present in the task catalogue", () => {
    expect(
      filterHomepagePingTaskBindings(
        { 3: ["node-a"], 7: ["node-a", "node-b"], 9: ["node-c"] },
        [3, 9],
      ),
    ).toEqual({ 3: ["node-a"], 9: ["node-c"] });
  });
});

describe("getHomepagePingTaskIdsByClient", () => {
  it("returns every task assigned to a client in stable task order", () => {
    const taskIdsByClient = getHomepagePingTaskIdsByClient({
      12: ["node-a", "node-b"],
      5: ["node-a"],
      9: ["node-c", "node-b"],
    });

    expect(Array.from(taskIdsByClient.entries())).toEqual([
      ["node-a", [5, 12]],
      ["node-c", [9]],
      ["node-b", [9, 12]],
    ]);
  });
});

describe("homepage Ping binding counters", () => {
  it("separates unique bound nodes from task-node binding pairs", () => {
    const bindings = {
      12: ["node-a", "node-b"],
      5: ["node-a"],
      9: ["node-c", "node-b"],
    };

    expect(countHomepagePingBoundClients(bindings)).toBe(3);
    expect(countHomepagePingBindingPairs(bindings)).toBe(5);
  });
});
