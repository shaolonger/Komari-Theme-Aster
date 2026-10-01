import { describe, expect, it } from "vitest";
import { foldHops, numberText, routeEvidence, sampleBand } from "../reportMetrics";
import type { ReportHop, ReportSample } from "@/services/reportObservatory";
const hop = (ttl: number, asn: string): ReportHop => ({ ttl, asn, address: "202.97.1." + ttl, rttMs: 12, lossPercent: 40 });
describe("network report metric semantics", () => {
  it("folds only contiguous single-AS hops and preserves unknown and multi-origin segments", () => {
    const hops = [hop(1, "4134"), hop(2, "4134"), hop(3, ""), hop(4, "4134"), hop(6, "4134"), hop(7, "4134 4809"), hop(8, "4134 4809")];
    const folded = foldHops(hops, true);
    expect(folded.map((g) => g.map((h) => h.ttl))).toEqual([[1, 2], [3], [4], [6], [7], [8]]);
    expect(folded[0][0].lossPercent).toBe(40); // not summed or averaged
    expect(foldHops(hops, false)).toHaveLength(hops.length);
  });
  it("identifies observed ASN evidence without certifying a GIA product", () => {
    const evidence = routeEvidence([hop(1, "4809"), hop(2, "4134"), hop(3, "AS4809")]);
    expect(evidence[0].ttls).toEqual([1, 3]);
    expect(evidence.map((e) => e.label).join(" ")).not.toContain("GIA");
    expect(routeEvidence([hop(1, "")])).toEqual([]);
  });
  it("unmeasured/failed attempts are distinct from actual zero-latency samples", () => {
    const sample: ReportSample = { index: 1, state: "ok", rttMs: 0, address: "1.1.1.1", error: "" };
    expect(sampleBand()).toBe("unmeasured");
    expect(sampleBand(sample)).toBe("fast");
    expect(sampleBand({ ...sample, state: "timeout", rttMs: null })).toBe("failure");
    expect(numberText(null)).toBe("—");
    expect(numberText(0)).toBe("0.0");
  });
});
