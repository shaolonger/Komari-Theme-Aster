import { describe, expect, it } from "vitest";
import { fullResultUrl, projectFullResult } from "../instanceReport/fullResults";
import { resultToolkit } from "../instanceReport/resultToolkit";
import type { ReportFullResult } from "../instanceReport/model";

const toolkit = resultToolkit();
const sample = (): ReportFullResult => ({ id: "result-a", roundId: "round-a", module: "tcpquality-full", time: Date.parse("2026-11-01T00:00:00Z"), state: "ok", url: "https://tcpquality.ibsgss.uk/r/example", profile: "AUTO", truncated: false, sections: [] });
describe("complete result archival and visual exports", () => {
  it("keeps only canonical official report links", () => {
    expect(fullResultUrl("tcpquality-full", "https://tcpquality.ibsgss.uk/r/example")).toBe("https://tcpquality.ibsgss.uk/r/example");
    expect(fullResultUrl("nodequality-full", "https://www.nodequality.com/r/example")).toBe("https://www.nodequality.com/r/example");
    for (const url of ["javascript:alert(1)", "https://tcpquality.ibsgss.uk.evil/r/a", "https://user@tcpquality.ibsgss.uk/r/a", "https://tcpquality.ibsgss.uk/r/a?next=evil", "http://tcpquality.ibsgss.uk/r/a"]) expect(fullResultUrl("tcpquality-full", url)).toBe("");
  });
  it("archives the full result independently of the metric evidence allowlist", () => {
    const result = projectFullResult("nodequality-full", "round-a", { id: "job", completedAt: "2026-11-01T00:00:00Z", data: { state: "ok", reportUrl: "https://nodequality.com/r/example", sections: { "ip_quality.json": JSON.stringify({ rtt_ms: 12, token: "SECRET", nested: { password: "SECRET", success: true } }), "net_quality.log": "\x1b[32m网络质量\x1b[0m", "../../credentials": "SECRET" } } });
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(result?.url).toBe("https://nodequality.com/r/example");
    expect(result?.sections).toHaveLength(2);
    expect(result?.sections[1]?.text).toContain("\x1b[32m");
  });
  it("parses quoted CSV fields and embedded newlines without losing columns", () => {
    expect(toolkit.csv('\uFEFF测点,值\r\n"Shanghai, CN","first\nsecond"\r\n"a""b",24')).toEqual([["测点", "值"], ["Shanghai, CN", "first\nsecond"], ['a"b', "24"]]);
  });
  it("paginates every result row and keeps text inside the printable image", () => {
    const result = sample(); result.sections = [{ name: "data", title: "测量", format: "csv", text: "测点,平均延迟ms\n" + Array.from({ length: 180 }, (_, i) => `unique-${i},${i}`).join("\n") }];
    const pages = toolkit.unified(result, "<img onerror=alert(1)>", "UTC");
    expect(pages.length).toBeGreaterThan(2);
    const svg = pages.join(""); expect(svg).not.toContain("<img");
    for (let i = 0; i < 180; i++) expect(svg).toContain(`unique-${i}`);
    for (const page of pages) for (const match of page.matchAll(/<text x="[^"]+" y="([\d.]+)"/g)) expect(Number(match[1])).toBeLessThanOrEqual(1504);
  });
  it("splits a long upstream vector into complete consecutive windows", () => {
    const result = sample(); result.originalPages = [{ title: "原报告", svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="4000" viewBox="0 0 1000 4000"><text y="3999">LAST</text></svg>' }];
    const pages = toolkit.original(result); expect(pages).toHaveLength(4);
    expect(pages[0]).toContain('viewBox="0 0 1000 1280"'); expect(pages.at(-1)).toContain('viewBox="0 3840 1000 160"');
    expect(pages.at(-1)).toContain("LAST");
  });
  it("preserves original terminal colors and requires real original content", () => {
    const result = sample(); expect(() => toolkit.original(result)).toThrow();
    result.module = "nodequality-full"; result.sections = [{ name: "net_quality.log", title: "网络质量", format: "terminal", text: "\x1b[31mFAIL\x1b[0m\nOK" }];
    const pages = toolkit.original(result); expect(pages[0]).toContain('fill="#bd0013"'); expect(pages[0]).not.toContain("\x1b");
  });
  it("removes terminal commands, XML control bytes and split surrogates from both image styles", () => {
    const result = sample(); result.module = "nodequality-full";
    result.sections = [{ name: "net_quality.log", title: "网络质量", format: "terminal", text: '\x1b]0;terminal title\x07\x1b]8;;https://example.com\x1b\\\x1b[32m真实结果😀\x1b[0m\x1b]8;;\x07\n\x00\x08\x0b\x0c\x1f\ud800末行' }];
    for (const svg of [...toolkit.original(result), ...toolkit.unified(result, "node\x00", "UTC")]) {
      expect(svg).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff]/u);
      expect(svg).not.toContain("terminal title"); expect(svg).not.toContain("https://example.com");
      expect(svg).toContain("末"); expect(svg).toContain("😀");
    }
    expect(toolkit.original(result)[0]).toContain('fill="#4ab118"');
  });
  it("writes UTF-8 ZIP entries with bounded data and correct directory offsets", () => {
    const bytes = toolkit.zip([{ name: "检测/01.png", bytes: new Uint8Array([1, 2, 3]) }]), view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(6, true)).toBe(0x800);
    const end = bytes.length - 22, directory = view.getUint32(end + 16, true);
    expect(view.getUint32(directory, true)).toBe(0x02014b50);
    expect(view.getUint16(end + 10, true)).toBe(1);
  });
});
