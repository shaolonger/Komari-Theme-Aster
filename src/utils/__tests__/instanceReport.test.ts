import { describe, expect, it } from "vitest";
import {
  buildReport,
  metricStats,
  pingStats,
  trafficStats,
} from "../instanceReport/aggregate";
import { projectEvidence, redactReport } from "../instanceReport/privacy";
import {
  renderReportHtml,
  safeJson,
  reportFilename,
} from "../instanceReport/render";
import { parseReportDate } from "../instanceReport/dates";
import { validateReportRange } from "../instanceReport/model";
import type { ReportInput, ReportMetric } from "../instanceReport/model";

const start = Date.parse("2026-10-01T00:00:00Z");
const range = { start, end: start + 1000, timeZone: "UTC" };
function metric(key: string, values: number[]): ReportMetric {
  return {
    key,
    label: key,
    unit: "B",
    precision: "返回点",
    points: values.map((v, i) => ({ t: start + i * 200, v })),
  };
}
function input(): ReportInput {
  return {
    schemaVersion: 1,
    reportId: "report-test",
    generatedAt: start + 2000,
    range,
    theme: "light",
    showAddresses: false,
    backend: "official-v1.4",
    node: {
      uuid: "node-1",
      name: "Tokyo",
      fields: [],
      memory: 4000,
      disk: 8000,
      swap: 0,
      cores: 4,
      ip: [],
      trafficLimit: 0,
      trafficRule: "",
      snapshot: { online: null, uptime: null, updatedAt: null },
    },
    metrics: [metric("cpu", [0, 5, 10])],
    pings: [],
    sources: [],
    network: [],
  };
}

describe("VPS report statistics and archival", () => {
  it("keeps true zero, caps time weights across gaps, excludes the half-open end", () => {
    const points = [
      { t: start, v: 10 },
      { t: start + 100, v: 20 },
      { t: start + 200, v: null },
      { t: start + 800, v: 40 },
      { t: start + 900, v: 0 },
      { t: range.end, v: 999 },
    ];
    const result = metricStats(points, range);
    expect(result.mean).toBe(17.5);
    expect(result.count).toBe(4);
    expect(result.min).toBe(0);
    expect(result.coveredMs).toBe(400);
    expect(result.gaps).toEqual([{ start: start + 200, end: start + 800 }]);
    expect(result.p95).toBe(40);
  });
  it("deduplicates boundaries and sorts the archived series before rendering", () => {
    const source = input();
    source.metrics[0]!.points = [
      { t: start + 200, v: 9 },
      { t: start, v: 0 },
      { t: start + 200, v: 4 },
    ];
    const report = buildReport(source);
    expect(report.metrics[0]!.points.map((p) => p.v)).toEqual([0, 4]);
    expect(source.metrics[0]!.points).toHaveLength(3);
  });
  it("recognizes adjacent retention tiers with different sampling intervals without inventing gaps", () => {
    const points = [0, 900000, 1800000, 2700000, 3600000, ...Array.from({ length: 10 }, (_, i) => 3660000 + i * 60000)].map(t => ({ t: start + t, v: 1 }));
    const period = { start, end: points.at(-1)!.t + 60000, timeZone: "UTC" };
    const result = metricStats(points, period);
    expect(result.gaps).toEqual([]);
    expect(result.coveredMs).toBe(period.end - period.start);
    expect(result.mean).toBe(1);
  });
  it("still marks an actual missing interval within a regular sampling tier", () => {
    const points = [0, 60000, 120000, 240000, 300000, 360000].map(t => ({ t: start + t, v: 1 }));
    const result = metricStats(points, { start, end: start + 420000, timeZone: "UTC" });
    expect(result.gaps).toEqual([{ start: start + 180000, end: start + 240000 }]);
  });
  it("weights loss and successful latency by probe counts, preserving valid zero latency", () => {
    const result = pingStats({
      id: 1,
      name: "task",
      protocol: "tcp",
      target: "",
      interval: 60,
      points: [
        { t: start, v: 0, sent: 1, lost: 0, valid: 1 },
        { t: start + 100, v: 100, sent: 100, lost: 10, valid: 90 },
        { t: start + 200, v: null, sent: 10, lost: 10, valid: 0 },
      ],
    });
    expect(result.mean).toBeCloseTo(9000 / 91);
    expect(result.loss).toBeCloseTo(20 / 111);
    expect(result.sent).toBe(111);
  });
  it("does not count counter reset segments or invent a missing traffic direction", () => {
    const result = trafficStats(
      [metric("net_total_up", [100, 180, 20, 50])],
      range,
    );
    expect(result.up).toBe(110);
    expect(result.down).toBeNull();
    expect(result.resets).toBe(1);
    expect(result.partial).toBe(true);
  });
  it("rejects invalid ranges, calendar overflow, and local times skipped by DST", () => {
    expect(() =>
      validateReportRange({ ...range, end: start - 1 }, start),
    ).toThrow();
    expect(() => validateReportRange(range, start)).toThrow();
    expect(() =>
      validateReportRange(
        { ...range, end: start + 367 * 86400000 },
        start + 400 * 86400000,
      ),
    ).not.toThrow();
    expect(parseReportDate("2026-02-30T10:00", "UTC")).toBeNull();
    expect(
      parseReportDate("2026-03-08T02:30", "America/Los_Angeles"),
    ).toBeNull();
    expect(parseReportDate("2026-03-09T02:30", "America/Los_Angeles")).toBe(
      Date.parse("2026-03-09T09:30:00Z") / 1000,
    );
  });
  it("scrubs hidden evidence and targets without corrupting ISO timestamps or time zones", () => {
    const source = input();
    source.node.ip = ["203.0.113.17", "2001:db8::1234"];
    source.node.name = "203.0.113.17 node";
    source.node.fields = [["到期", "2026-12-15T09:30:00Z"]];
    source.pings = [
      {
        id: 2,
        name: "target",
        protocol: "tcp",
        target: "private.internal",
        interval: 60,
        points: [],
      },
    ];
    source.network = [
      {
        id: "e1",
        module: "routes",
        state: "ok",
        time: start,
        source: "private.internal",
        direction: "",
        target: "private.internal",
        detail: { hops: [{ address: "198.51.100.12", asn: "AS64500" }] },
      },
    ];
    const clean = redactReport(source),
      text = JSON.stringify(clean);
    for (const secret of [
      "203.0.113.17",
      "2001:db8::1234",
      "198.51.100.12",
      "private.internal",
    ])
      expect(text).not.toContain(secret);
    expect(clean.node.fields[0]![1]).toBe("2026-12-15T09:30:00Z");
    expect(clean.range.timeZone).toBe("UTC");
    expect(source.node.ip[0]).toBe("203.0.113.17");
    source.showAddresses = true;
    expect(redactReport(source).node.ip).toEqual(source.node.ip);
  });
  it("excludes passthrough credentials and raw diagnostic command output", () => {
    const result = JSON.stringify(
      projectEvidence({
        hops: [{ address: "1.2.3.4", token: "SECRET" }],
        password: "SECRET",
        authorization: "SECRET",
        diagnostic: "SECRET",
        options: { token: "SECRET" },
        rawOutput: "SECRET",
        tcpQuality: { sent: 10, received: 9 },
      }),
    );
    expect(result).not.toContain("SECRET");
    expect(result).toContain('"received":9');
  });
  it("embeds all chapters and frozen inputs with safe script boundaries and no external dependencies", () => {
    const source = input();
    source.node.name = '</script><img src=x onerror="alert(1)">';
    const report = buildReport(source),
      html = renderReportHtml(report);
    for (const id of [
      "overview",
      "resources",
      "network",
      "traffic",
      "stability",
      "assets",
      "events",
      "sources",
    ])
      expect(html).toContain(`id="${id}" class="chapter"`);
    expect(html).not.toContain(source.node.name);
    expect(html).toContain("\\u003c/script\\u003e");
    expect(html).not.toMatch(/<(?:script|link|img)[^>]+(?:src|href)=/);
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("数据 JSON");
    const data = html.match(
      /<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/,
    )![1]!;
    expect(JSON.parse(data).reportId).toBe(report.reportId);
    expect(safeJson("\u2028</script>")).not.toContain("</script>");
    expect(reportFilename(report, "html")).not.toMatch(/[<>"/\\:]/);
  });
  it("does not invent uptime percentages or health scores for an empty history", () => {
    const source = input();
    source.metrics = [];
    const html = renderReportHtml(buildReport(source));
    expect(html).toContain("无历史数据 · 仅配置快照");
    expect(html).toContain("不可计算");
    expect(html).not.toContain("100% 在线");
    expect(html).not.toContain("健康评分");
  });
});
