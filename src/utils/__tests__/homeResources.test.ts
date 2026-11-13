import { describe, expect, it } from "vitest";
import { summarizeHomeResources } from "../homeResources";

const node = (uuid: string, trafficUp = 30, trafficDown = 70, updatedAt = 1) => ({ uuid, trafficUp, trafficDown, updatedAt });
const meta = (traffic_limit_type = "max", traffic_limit = 200, mem_total = 1024) => ({ mem_total, traffic_limit, traffic_limit_type });

describe("fleet resource totals", () => {
  it("uses each node's accounting rule before adding usage and includes cached/offline reports", () => {
    const nodes = ["up", "down", "sum", "min", "max"].map(id => node(id));
    const metadata = new Map(nodes.map(n => [n.uuid, meta(n.uuid)]));
    const result = summarizeHomeResources(nodes, metadata);
    expect(result).toMatchObject({ memoryTotal: 5120, memoryMissing: 0, limitedCount: 5, limitedMeasured: 5, limitedUsed: 300, limitedQuota: 1000, limitedRemaining: 700 });
  });

  it("keeps unlimited usage separate and does not offset one node's overage against another's quota", () => {
    const result = summarizeHomeResources(
      [node("over", 300, 0), node("spare", 0, 0), node("unlimited", 1000, 2000)],
      new Map([["over", meta("up")], ["spare", meta()], ["unlimited", meta("sum", 0)]]),
    );
    expect(result).toMatchObject({ limitedUsed: 300, limitedQuota: 400, limitedRemaining: 200, unlimitedCount: 1, unlimitedMeasured: 1, unlimitedUsed: 3000 });
  });

  it("distinguishes no report and missing metadata from real zero usage", () => {
    const result = summarizeHomeResources(
      [node("zero", 0, 0), node("pending", 0, 0, 0), node("missing"), node("invalid")],
      new Map([["zero", meta()], ["pending", meta()], ["invalid", meta("sum", Number.NaN, Number.NaN)]]),
    );
    expect(result).toMatchObject({ memoryTotal: 2048, memoryMissing: 2, limitedCount: 2, limitedMeasured: 1, limitedUsed: 0, limitedQuota: 400, limitedRemaining: 200, metadataMissing: 2 });
  });

  it("only includes the supplied visible fleet, never other metadata entries", () => {
    const result = summarizeHomeResources([node("visible")], new Map([["visible", meta()], ["hidden", meta("sum", 9999, 9999)]]));
    expect(result.memoryTotal).toBe(1024);
    expect(result.limitedQuota).toBe(200);
    expect(summarizeHomeResources([], new Map()).memoryTotal).toBe(0);
  });
});
