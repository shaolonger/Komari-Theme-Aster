import { describe, expect, it } from "vitest";
import { matchesNodeSearch, readNodeSearchInput, splitNodeSearchGroups, writeNodeSearchInput } from "../nodeSearch";

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

describe("multi-VPS search groups", () => {
  it("combines comma/newline alternatives while retaining AND within each group", () => {
    const groups = splitNodeSearchGroups("hk mini，jp taxi\r\nSG edge");
    expect(groups).toEqual(["hk mini", "jp taxi", "SG edge"]);
    const match = (...fields: string[]) => groups.some(group => matchesNodeSearch(group, ...fields));
    expect(match("mini", "HK")).toBe(true);
    expect(match("jp.taxi-01")).toBe(true);
    expect(match("hk edge")).toBe(false);
  });
  it("normalizes width/whitespace and deduplicates case-insensitively without splitting names on spaces", () => {
    expect(splitNodeSearchGroups(" , ＨＫ   mini, hk mini\nmac mini m4 16g,,\r\n")).toEqual(["HK mini", "mac mini m4 16g"]);
    expect(splitNodeSearchGroups(" ，,\r\n")).toEqual([]);
    expect(splitNodeSearchGroups("2001:db8::1,192.0.2.10,host-1.example")).toEqual(["2001:db8::1", "192.0.2.10", "host-1.example"]);
  });
  it("distinguishes committed tokens and the live draft, including trailing separators", () => {
    expect(readNodeSearchInput("hk mini, jp ta")).toEqual({ tokens: ["hk mini"], draft: "jp ta" });
    expect(readNodeSearchInput("hk mini，\n jp taxi, ")).toEqual({ tokens: ["hk mini", "jp taxi"], draft: "" });
    expect(readNodeSearchInput("mac mini ")).toEqual({ tokens: [], draft: "mac mini " });
  });
  it("round-trips deletions, edits and committed duplicates without losing the live draft", () => {
    expect(readNodeSearchInput(writeNodeSearchInput(["hk mini", "HK mini"], "jp ta"))).toEqual({ tokens: ["hk mini"], draft: "jp ta" });
    expect(writeNodeSearchInput([], "jp ta")).toBe("jp ta");
    expect(readNodeSearchInput(writeNodeSearchInput(["hk mini", "jp taxi"]))).toEqual({ tokens: ["hk mini", "jp taxi"], draft: "" });
  });
});
