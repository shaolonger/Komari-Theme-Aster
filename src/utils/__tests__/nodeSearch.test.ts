import { describe, expect, it } from "vitest";
import { matchesNodeSearch } from "../nodeSearch";

describe("VPS search", () => {
  it("matches all space-separated terms in any order across fields", () => {
    expect(matchesNodeSearch("hk dc2 优化", "香港｜线路｜ipv4｜优化 56idc-hk.kvm.nat.v1.dc2")).toBe(true);
    expect(matchesNodeSearch(" DC2   Hk\t优化 ", "香港｜优化", "56idc-hk.kvm.nat.v1.dc2")).toBe(true);
    expect(matchesNodeSearch("hk dc2 不存在", "香港 优化 56idc-hk.kvm.nat.v1.dc2")).toBe(false);
  });
  it("handles blank, Unicode width, punctuation, UUID and optional fields", () => {
    expect(matchesNodeSearch("  ", undefined)).toBe(true);
    expect(matchesNodeSearch("ｈｋ node-1", "HK", null, "node-1")).toBe(true);
    expect(matchesNodeSearch("node-1 hk", ["node-1", "香港 HK"])).toBe(true);
  });
});
