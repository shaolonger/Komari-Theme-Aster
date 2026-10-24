import { describe, expect, it } from "vitest";
import { routeHeadline } from "../carrierRoutePresentation";
import type { RouteEvidence } from "@/services/homeRoutes";
const value = (labels: string[], extra: Partial<RouteEvidence> = {}): RouteEvidence => ({
  label: labels.join(" / "), networkLabels: labels, asns: [], at: "2026-10-24T00:00:00.000Z",
  reportId: "round", diagnostic: "", samples: 3, observed: 3, confirmed: 1, observations: [], state: "partial", ...extra,
});
describe("card route presentation policy", () => {
  it.each([
    [["163", "CN2"], "CN2"], [["CN2", "CTGNet", "163"], "CN2"], [["163", "CTGNet"], "CTGNet"],
    [["4837", "9929"], "9929"], [["10099", "4837", "9929"], "9929"], [["4837", "10099"], "10099"],
    [["9808", "CMI", "CMIN2"], "CMIN2"], [["9808", "CMI"], "CMI"],
  ] as [string[], string][]) ("selects one observed label from %j", (labels, expected) => {
    expect(routeHeadline(value(labels))).toBe(expected);
    expect(routeHeadline(value([...labels].reverse()))).toBe(expected);
  });
  it("retains all names in full mode and never turns combined observations into GIA products", () => {
    const source = value(["163", "CN2", "9929"]);
    expect(routeHeadline(source, "full")).toBe("163 + CN2 + 9929");
    expect(routeHeadline(source)).toBe("CN2");
    expect(routeHeadline(value(["CTGNet"]))).toBe("CTGNet");
    expect(routeHeadline(value(["AS65001", "AS65002"]))).toBe("AS65001");
    expect(source.networkLabels).toEqual(["163", "CN2", "9929"]);
  });
  it("does not invent a cross-carrier quality ranking or promote a failed result", () => {
    expect(routeHeadline(value(["9929", "CN2", "CMIN2"]))).toBe("9929");
    expect(routeHeadline(value(["CMIN2", "9929", "CN2"]))).toBe("CMIN2");
    expect(routeHeadline(value(["CN2"], { state: "missing", observed: 0 }))).toBe("无覆盖");
    expect(routeHeadline(value(["CN2"], { state: "stale", observed: 0 }))).toBe("无覆盖");
    expect(routeHeadline(null)).toBe("未探测");
  });
  it("handles older summaries without requiring a new measurement", () => {
    expect(routeHeadline(value(["163", "CN2"], { networkLabels: undefined }))).toBe("CN2");
  });
});
