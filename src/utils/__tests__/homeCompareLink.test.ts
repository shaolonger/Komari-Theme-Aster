import { describe, expect, it } from "vitest";
import { buildHomeCompareUrl } from "@/utils/pingCompareLink";

describe("home comparison entry", () => {
  it("opens the comparison page with no VPS selected unless at least two were explicitly chosen", () => {
    expect(buildHomeCompareUrl()).toBe("/compare");
    expect(buildHomeCompareUrl([])).toBe("/compare");
    expect(buildHomeCompareUrl(["node-a"])).toBe("/compare");
  });

  it("carries only the explicit, unique VPS selection into comparison", () => {
    expect(buildHomeCompareUrl([" node-a ", "node-b", "node-a", " "])).toBe(
      "/compare?nodes=node-a%2Cnode-b",
    );
  });
});
