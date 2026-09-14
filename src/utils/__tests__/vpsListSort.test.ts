import { describe, expect, it } from "vitest";
import {
  normalizeVpsListSorts,
  sortVpsListNodes,
  toggleVpsListSort,
  type VpsListSortableNode,
} from "@/utils/vpsListSort";

function node(
  uuid: string,
  partial: Partial<VpsListSortableNode> = {},
): VpsListSortableNode {
  return {
    uuid,
    weight: 0,
    online: true,
    name: uuid,
    group: "",
    region: "",
    provider: "",
    cpu: 0,
    memory: 0,
    disk: 0,
    load: 0,
    upload: 0,
    download: 0,
    trafficUsed: 0,
    trafficRemaining: 0,
    trafficUsage: 0,
    trafficLimit: 0,
    latency: 0,
    loss: 0,
    uptime: 0,
    updatedAt: 0,
    expiry: 0,
    expireDays: 0,
    price: 0,
    risk: 0,
    completeness: 1,
    ...partial,
  };
}

describe("VPS list sort normalization", () => {
  it("deduplicates conditions and migrates legacy keys", () => {
    expect(
      normalizeVpsListSorts([
        { key: "cpu", direction: "desc" },
        { key: "cpu", direction: "asc" },
        { key: "unknown", direction: "asc" },
      ]),
    ).toEqual([{ key: "cpu", direction: "desc" }]);
    expect(normalizeVpsListSorts(undefined, "traffic")).toEqual([
      { key: "trafficUsage", direction: "desc" },
    ]);
    expect(normalizeVpsListSorts(undefined, "unknown")).toEqual([
      { key: "weight", direction: "asc" },
    ]);
  });

  it("cycles recommended, opposite, and default while supporting additive sorts", () => {
    expect(toggleVpsListSort([], "cpu", false)).toEqual([{ key: "cpu", direction: "desc" }]);
    expect(toggleVpsListSort([{ key: "cpu", direction: "desc" }], "cpu", false)).toEqual([
      { key: "cpu", direction: "asc" },
    ]);
    expect(toggleVpsListSort([{ key: "cpu", direction: "asc" }], "cpu", false)).toEqual([
      { key: "weight", direction: "asc" },
    ]);
    expect(
      toggleVpsListSort([{ key: "status", direction: "desc" }], "expiry", true),
    ).toEqual([
      { key: "status", direction: "desc" },
      { key: "expiry", direction: "asc" },
    ]);
  });
});

describe("VPS list sorting", () => {
  it("sorts multiple conditions in priority order", () => {
    const nodes = [
      node("a", { online: true, trafficUsage: 0.7, expireDays: 20 }),
      node("b", { online: true, trafficUsage: 0.7, expireDays: 5 }),
      node("c", { online: false, trafficUsage: 0.9, expireDays: 1 }),
    ];
    expect(
      sortVpsListNodes(nodes, [
        { key: "status", direction: "desc" },
        { key: "trafficUsage", direction: "desc" },
        { key: "expireDays", direction: "asc" },
      ]).map((item) => item.uuid),
    ).toEqual(["b", "a", "c"]);
  });

  it("keeps missing and offline realtime metrics last in both directions", () => {
    const nodes = [
      node("offline", { online: false, cpu: 99 }),
      node("missing", { cpu: null }),
      node("low", { cpu: 10 }),
      node("high", { cpu: 80 }),
    ];
    expect(sortVpsListNodes(nodes, [{ key: "cpu", direction: "desc" }]).map((item) => item.uuid)).toEqual([
      "high",
      "low",
      "missing",
      "offline",
    ]);
    expect(sortVpsListNodes(nodes, [{ key: "cpu", direction: "asc" }]).map((item) => item.uuid)).toEqual([
      "low",
      "high",
      "missing",
      "offline",
    ]);
  });

  it("uses weight, name, and uuid as deterministic fallbacks", () => {
    const nodes = [
      node("c", { cpu: 10, weight: 2, name: "Beta" }),
      node("b", { cpu: 10, weight: 1, name: "Alpha" }),
      node("a", { cpu: 10, weight: 1, name: "Alpha" }),
    ];
    expect(sortVpsListNodes(nodes, [{ key: "cpu", direction: "desc" }]).map((item) => item.uuid)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
