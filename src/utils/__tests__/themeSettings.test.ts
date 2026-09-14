import { describe, expect, it } from "vitest";
import {
  filterHomepagePingTaskGroups,
  normalizeHomepagePingTaskGroups,
} from "@/utils/homepagePingSettings";
import { normalizeThemeSettings } from "@/utils/themeSettings";

describe("normalizeThemeSettings", () => {
  it("defaults desktop and mobile node cards to the compact scanning view", () => {
    expect(normalizeThemeSettings({}).desktopNodeViewMode).toBe("compact");
    expect(normalizeThemeSettings({}).mobileNodeViewMode).toBe("compact");
    expect(normalizeThemeSettings({ desktopNodeViewMode: "large" }).desktopNodeViewMode).toBe(
      "large",
    );
    expect(
      normalizeThemeSettings({ desktopNodeViewMode: "list", mobileNodeViewMode: "list" }),
    ).toMatchObject({ desktopNodeViewMode: "list", mobileNodeViewMode: "list" });
    expect(
      normalizeThemeSettings({ desktopNodeViewMode: "table" as never }).desktopNodeViewMode,
    ).toBe("compact");
  });

  it("defaults overview ratings on unless explicitly disabled", () => {
    expect(normalizeThemeSettings({}).showOverviewRatings).toBe(true);
    expect(normalizeThemeSettings({ showOverviewRatings: false }).showOverviewRatings).toBe(false);
  });

  it("normalizes the global display time zone", () => {
    expect(normalizeThemeSettings({}).displayTimeZone).toBe("system");
    expect(normalizeThemeSettings({ displayTimeZone: "Asia/Shanghai" }).displayTimeZone).toBe(
      "Asia/Shanghai",
    );
    expect(normalizeThemeSettings({ displayTimeZone: "Mars/Base" }).displayTimeZone).toBe(
      "system",
    );
  });

  it("keeps a node bound to multiple homepage Ping tasks", () => {
    expect(
      normalizeThemeSettings({
        homepagePingBindings: {
          7: ["node-a", "node-b"],
          3: ["node-a"],
          bad: ["ignored"],
        },
      }).homepagePingBindings,
    ).toEqual({
      3: ["node-a"],
      7: ["node-a", "node-b"],
    });
  });

  it("normalizes advanced homepage Ping settings safely", () => {
    const settings = normalizeThemeSettings({
      homepagePingBindings: {
        7: ["node-a", "node-b"],
        3: ["node-a"],
      },
      homepagePingAggregationStrategy: "primary",
      homepagePingPrimaryTasks: {
        "node-a": 3,
        "node-b": 3,
        "node-c": 7,
      },
      homepagePingTaskGroups: {
        3: " 全球 ",
        7: "美国",
        bad: "ignored",
      },
    });

    expect(settings.homepagePingAggregationStrategy).toBe("primary");
    expect(settings.homepagePingPrimaryTasks).toEqual({ "node-a": 3 });
    expect(settings.homepagePingTaskGroups).toEqual({ 3: "全球", 7: "美国" });
  });

  it("defaults invalid homepage Ping strategy back to worst-first", () => {
    expect(
      normalizeThemeSettings({ homepagePingAggregationStrategy: "fastest" as never })
        .homepagePingAggregationStrategy,
    ).toBe("worst");
  });

  it("normalizes home VPS facet settings", () => {
    const settings = normalizeThemeSettings({
      homeFacetDimensions: [
        { id: "provider", label: "供应商", visible: true, order: 5 },
        { id: "line", label: "线路", visible: false, order: 30 },
      ],
      homeNodeFacets: {
        "node-a": {
          line: "CMI;CN2;CMI",
          purpose: ["落地"],
        },
      },
      homeDefaultFacetDimension: "provider",
      homeSelectedNodeUuids: "node-a,node-b,node-a",
      homeSavedViews: [
        {
          id: "core",
          name: "核心节点",
          selectedNodeUuids: ["node-a"],
          filters: { provider: "DMIT" },
          groupBy: "provider",
          sortKey: "risk",
        },
      ],
      homeDefaultSavedViewId: "core",
    });

    expect(settings.homeFacetDimensions.find((item) => item.id === "provider")).toMatchObject({
      label: "供应商",
      order: 5,
    });
    expect(settings.homeNodeFacets).toEqual({
      "node-a": {
        line: ["CMI", "CN2"],
        purpose: ["落地"],
      },
    });
    expect(settings.homeDefaultFacetDimension).toBe("provider");
    expect(settings.homeSelectedNodeUuids).toEqual(["node-a", "node-b"]);
    expect(settings.homeSavedViews).toHaveLength(1);
    expect(settings.homeDefaultSavedViewId).toBe("core");
  });
});

describe("filterHomepagePingTaskGroups", () => {
  it("removes display groups belonging to deleted Ping tasks", () => {
    expect(
      filterHomepagePingTaskGroups(
        normalizeHomepagePingTaskGroups({ 3: "公共", 7: "已删除", 9: "海外" }),
        [3, 9],
      ),
    ).toEqual({ 3: "公共", 9: "海外" });
  });
});
