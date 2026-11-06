import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readNodeQualityArchive } from "../instanceReport/nodeArchive";
import { projectFullResult } from "../instanceReport/fullResults";

function archive(files: [string, string][], method = 8) {
  return execFileSync("python3", ["-c", "import io,json,sys,zipfile,base64\nb=io.BytesIO()\nwith zipfile.ZipFile(b,'w',compression=int(sys.argv[1])) as z:\n for n,s in json.load(sys.stdin):z.writestr(n,s)\nprint(base64.b64encode(b.getvalue()).decode())", String(method)], { input: JSON.stringify(files), encoding: "utf8" }).trim();
}
describe("upstream NodeQuality report archive", () => {
  it.each([0, 8])("reads fixed ANSI logs from ZIP compression method %s", async method => {
    const sections = await readNodeQualityArchive(archive([["header_info.log", "### NodeQuality ###"], ["hardware_quality.log", "\x1b[41;97m硬件报告\x1b[0m"], ["net_quality.log", "上游网络测试"], ["net_quality.json", '{"Head":"machine data"}'], ["../secret.log", "SECRET"]], method));
    expect(sections.map(s => s.name)).toEqual(["header_info.log", "hardware_quality.log", "net_quality.log"]);
    expect(sections[1]?.text).toContain("\x1b[41;97m"); expect(JSON.stringify(sections)).not.toContain("SECRET");
  });
  it("never treats JSON or truncated JSON as an original terminal report", async () => {
    await expect(readNodeQualityArchive(archive([["net_quality.log", '{"Head": {"IP": "null"'], ["net_quality.json", '{"Head":{}}']]))).rejects.toThrow("不能用 JSON");
    const result = projectFullResult("nodequality-full", "round", { id: "job", completedAt: "2026-11-01T00:00:00Z", data: { sections: { "net_quality.json": '{"Head": {' } } });
    expect(result?.sections[0]?.format).toBe("json"); expect(result?.truncated).toBe(true);
  });
  it("uses complete retained ANSI logs even when an independent JSON file was truncated", () => {
    const logs = Object.fromEntries(["header_info", "hardware_quality", "ip_quality", "net_quality", "backroute_trace"].map(name => [name + ".log", "\x1b[32m真实终端报告\x1b[0m"]));
    const result = projectFullResult("nodequality-full", "round", { id: "job", completedAt: "2026-11-01T00:00:00Z", data: { sectionsTruncated: true, sections: { ...logs, "net_quality.json": '{"Head": {' } } });
    expect(result?.originalSections).toHaveLength(5);
    expect(result?.originalSections?.every(section => section.name.endsWith(".log"))).toBe(true);
    const truncatedLog = projectFullResult("nodequality-full", "round", { id: "job", completedAt: "2026-11-01T00:00:00Z", data: { sections: { ...logs, "net_quality.log": "x".repeat(60000) } } });
    expect(truncatedLog?.originalSections).toBeUndefined();
  });
  it("rejects corrupt ZIPs, duplicate logs and oversized expanded data", async () => {
    await expect(readNodeQualityArchive(btoa("not a zip"))).rejects.toThrow("ZIP");
    await expect(readNodeQualityArchive(archive([["header_info.log", "one"], ["header_info.log", "two"]]))).rejects.toThrow("重复");
    await expect(readNodeQualityArchive(archive([["net_quality.log", "x".repeat(2 * 1024 * 1024 + 1)]]))).rejects.toThrow("过大");
  });
  it("checks retained log integrity before displaying it", async () => {
    const bytes = Uint8Array.from(atob(archive([["net_quality.log", "ORIGINAL"]], 0)), c => c.charCodeAt(0));
    // ZIP headers are binary; decoded character offsets need not equal byte
    // offsets (the timestamp alone can contain multi-byte UTF-8 sequences).
    const header = new DataView(bytes.buffer);
    const index = 30 + header.getUint16(26, true) + header.getUint16(28, true);
    expect(new TextDecoder().decode(bytes.subarray(index, index + 8))).toBe("ORIGINAL");
    bytes[index] = 88;
    await expect(readNodeQualityArchive(btoa(String.fromCharCode(...bytes)))).rejects.toThrow("CRC");
  });
});
