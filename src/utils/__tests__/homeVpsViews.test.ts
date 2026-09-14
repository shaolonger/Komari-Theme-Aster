import { describe, expect, it } from "vitest";
import {
  HOME_FACET_CUSTOM,
  HOME_FACET_LEGACY_GROUP,
  HOME_FACET_LINE,
  HOME_FACET_PROVIDER,
  HOME_FACET_PURPOSE,
  HOME_FACET_REGION,
  buildHomeFacetNode,
  buildHomeFacetNodes,
  filterHomeFacetNodes,
  getHomeFacetOptions,
  normalizeHomeFacetDimensions,
  normalizeHomeFacetValues,
  normalizeHomeNodeFacets,
  normalizeHomeSavedViews,
} from "@/utils/homeVpsViews";
import type { NodeInfo } from "@/types/komari";

function node(partial: Partial<NodeInfo> & Pick<NodeInfo, "uuid" | "name">): NodeInfo {
  return {
    uuid: partial.uuid,
    name: partial.name,
    group: partial.group ?? "",
    region: partial.region ?? "",
    hidden: false,
    cpu_name: "",
    cpu_cores: 0,
    arch: "",
    virtualization: "",
    os: "",
    kernel_version: "",
    version: "",
    ipv4: "",
    ipv6: "",
    capability_ping: null,
    capability_private_ping_targets: null,
    gpu_name: "",
    mem_total: 0,
    swap_total: 0,
    disk_total: 0,
    weight: 0,
    price: 0,
    billing_cycle: "",
    auto_renewal: false,
    currency: "",
    provider: partial.provider ?? "",
    business_role: partial.business_role ?? "",
    expired_at: "",
    tags: partial.tags ?? "",
    public_remark: partial.public_remark ?? "",
    traffic_limit: 0,
    traffic_limit_type: "",
    created_at: "",
    updated_at: "",
  };
}

describe("home VPS facet values", () => {
  it("splits text values, trims, and deduplicates in first-seen order", () => {
    expect(normalizeHomeFacetValues(" DMIT;日本，CMI、DMIT\n落地 ")).toEqual([
      "DMIT",
      "日本",
      "CMI",
      "落地",
    ]);
  });

  it("keeps default dimensions while accepting valid custom dimensions", () => {
    const dimensions = normalizeHomeFacetDimensions([
      { id: "provider", label: "供应商", visible: false, order: 1 },
      { id: "owner", label: "负责人", visible: true, order: 25 },
      { id: "bad id", label: "ignored" },
    ]);

    expect(dimensions.map((item) => item.id)).toContain(HOME_FACET_LEGACY_GROUP);
    expect(dimensions.find((item) => item.id === HOME_FACET_PROVIDER)).toMatchObject({
      label: "供应商",
      visible: false,
      order: 1,
    });
    expect(dimensions.find((item) => item.id === "owner")).toMatchObject({
      label: "负责人",
      visible: true,
    });
    expect(dimensions.some((item) => item.id === "bad id")).toBe(false);
  });

  it("normalizes per-node facets and removes empty dimensions", () => {
    expect(
      normalizeHomeNodeFacets({
        "node-a": {
          line: "CMI; CN2; CMI",
          empty: " ",
        },
        " ": { line: "ignored" },
      }),
    ).toEqual({
      "node-a": {
        line: ["CMI", "CN2"],
      },
    });
  });
});

describe("home VPS facet nodes", () => {
  it("builds facets from legacy and asset metadata", () => {
    const item = buildHomeFacetNode(
      node({
        uuid: "node-a",
        name: "Tokyo Edge",
        group: "edge",
        region: "日本",
        provider: "DMIT",
        business_role: "落地",
        tags: "高优先级;原生",
      }),
      {
        "node-a": {
          [HOME_FACET_LINE]: ["CMI"],
          [HOME_FACET_REGION]: ["东京"],
        },
      },
    );

    expect(item.facets[HOME_FACET_LEGACY_GROUP]).toEqual(["edge"]);
    expect(item.facets[HOME_FACET_PROVIDER]).toEqual(["DMIT"]);
    expect(item.facets[HOME_FACET_REGION]).toEqual(["日本", "东京"]);
    expect(item.facets[HOME_FACET_LINE]).toEqual(["CMI"]);
    expect(item.facets[HOME_FACET_PURPOSE]).toEqual(["落地"]);
    expect(item.facets[HOME_FACET_CUSTOM]).toEqual(["高优先级", "原生"]);
  });

  it("returns options in first-seen order for a dimension", () => {
    const nodes = buildHomeFacetNodes([
      node({ uuid: "a", name: "a", provider: "DMIT" }),
      node({ uuid: "b", name: "b", provider: "Vultr" }),
      node({ uuid: "c", name: "c", provider: "DMIT" }),
    ]);

    expect(getHomeFacetOptions(nodes, HOME_FACET_PROVIDER)).toEqual(["DMIT", "Vultr"]);
  });

  it("applies selected VPS as the strongest constraint before facet filters", () => {
    const nodes = buildHomeFacetNodes([
      node({ uuid: "a", name: "a", provider: "DMIT", region: "日本" }),
      node({ uuid: "b", name: "b", provider: "DMIT", region: "美国" }),
      node({ uuid: "c", name: "c", provider: "Vultr", region: "日本" }),
    ]);

    expect(
      filterHomeFacetNodes({
        nodes,
        selectedNodeUuids: ["a", "b"],
        filters: {
          [HOME_FACET_PROVIDER]: ["DMIT"],
          [HOME_FACET_REGION]: ["日本"],
        },
      }).map((item) => item.uuid),
    ).toEqual(["a"]);
  });
});

describe("home saved views", () => {
  it("normalizes saved views with filters, selected nodes, and groupBy fallback", () => {
    expect(
      normalizeHomeSavedViews([
        {
          id: "jp-egress",
          name: "日本落地",
          selectedNodeUuids: "a,b,b",
          filters: {
            region: "日本",
            line: ["CMI", "CMI"],
          },
          groupBy: "line",
          sortKey: "risk",
        },
        {
          id: "bad view",
          name: "",
        },
      ]),
    ).toEqual([
      {
        id: "jp-egress",
        name: "日本落地",
        selectedNodeUuids: ["a", "b"],
        filters: {
          region: ["日本"],
          line: ["CMI"],
        },
        groupBy: HOME_FACET_LINE,
        sortKey: "risk",
        sorts: [{ key: "risk", direction: "desc" }],
      },
    ]);
  });

  it("keeps valid multi-field sorts and drops duplicate or invalid conditions", () => {
    expect(
      normalizeHomeSavedViews([
        {
          id: "pressure",
          name: "压力优先",
          groupBy: "legacyGroup",
          sortKey: "weight",
          sorts: [
            { key: "status", direction: "desc" },
            { key: "trafficUsage", direction: "desc" },
            { key: "status", direction: "asc" },
            { key: "bad", direction: "asc" },
          ],
        },
      ])[0]?.sorts,
    ).toEqual([
      { key: "status", direction: "desc" },
      { key: "trafficUsage", direction: "desc" },
    ]);
  });
});
