import { describe, expect, it } from "vitest";
import { sortCostSummaryDetails, type CostSummaryDetail } from "../cost";

const now = Date.parse("2026-11-13T12:00:00Z");
function row(uuid: string, expiredAt: string, extra: Partial<CostSummaryDetail> = {}): CostSummaryDetail {
  return { uuid, name: uuid, expiredAt, region: "US", weight: 0, priceCny: 1, monthlyCny: 1, remainingCny: 1, billingCycleDays: 30, counted: true, note: "", ...extra };
}
const ids = (rows: CostSummaryDetail[]) => rows.map(r => r.uuid);

describe("asset expiry sorting", () => {
  const rows = [
    row("far", "2027-01-01T00:00:00Z"),
    row("unknown", "0001-01-01T00:00:00Z"),
    row("ignored", "2026-11-15T08:00:00Z", { counted: false, note: "已忽略" }),
    row("expired", "2026-11-12T00:00:00Z"),
    row("free", "2026-11-15T01:00:00Z", { counted: false, note: "免费" }),
    row("long", "2226-01-01T00:00:00Z"),
    row("lifetime", "2026-11-14T00:00:00Z", { billingCycleDays: -1 }),
  ];
  it("sorts exact timestamps globally, including excluded/free assets", () => {
    expect(ids(sortCostSummaryDetails(rows, "expiry", "asc", now))).toEqual(["expired", "free", "ignored", "far", "lifetime", "long", "unknown"]);
    expect(rows[0].uuid).toBe("far");
  });
  it("reverses dated rows while keeping long-term, lifetime and unknown entries last", () => {
    expect(ids(sortCostSummaryDetails(rows, "expiry", "desc", now))).toEqual(["far", "ignored", "free", "expired", "lifetime", "long", "unknown"]);
  });
  it("accepts unix seconds/milliseconds, ignores sentinel dates, and breaks ties stably", () => {
    const timestamp = now + 86400000;
    const data = [row("b", String(timestamp)), row("sentinel", "-1"), row("a", String(timestamp / 1000))];
    expect(ids(sortCostSummaryDetails(data, "expiry", "asc", now))).toEqual(["a", "b", "sentinel"]);
  });
  it("preserves asset eligibility grouping for existing numeric sort modes", () => {
    const data = [row("free", "", { counted: false, priceCny: 0 }), row("high", "", { priceCny: 9 }), row("low", "", { priceCny: 2 })];
    expect(ids(sortCostSummaryDetails(data, "price", "asc", now))).toEqual(["low", "high", "free"]);
    expect(ids(sortCostSummaryDetails(data, "price", "desc", now))).toEqual(["high", "low", "free"]);
  });
});
