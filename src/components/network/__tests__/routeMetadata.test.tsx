import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RouteHopIdentity, RouteMetadataObservation, RoutePathSummary } from "../RouteMetadata";
import { foldHops } from "../reportMetrics";
import type { ReportHop, ReportMeasurement } from "@/services/reportObservatory";
import { projectEvidence } from "@/utils/instanceReport/privacy";

const hop: ReportHop = { ttl: 5, address: "59.43.246.117", asn: "", rttMs: 699.75,
  network: "中国电信", location: "中国 · 上海", domain: "chinatelecom.com.cn", whois: "CN2-BackBone",
  geoSource: "NextTrace / NextTrace-API", geoQueriedAt: "2026-10-23T05:06:42Z" };

describe("route metadata evidence presentation", () => {
  it("shows location, network, WHOIS and sources even without an origin ASN", () => {
    const html = renderToStaticMarkup(<RouteHopIdentity hop={hop} />);
    for (const value of ["中国电信", "中国 · 上海", "chinatelecom.com.cn", "CN2-BackBone", "NextTrace / NextTrace-API"])
      expect(html).toContain(value);
    expect(html).not.toContain("AS4809");
    expect(renderToStaticMarkup(<RouteHopIdentity hop={{ ...hop, domain: "<script>bad</script>" }} />)).toContain("&lt;script&gt;");
  });
  it("retains different locations and networks when folding a single AS", () => {
    const first = { ...hop, asn: "4809" };
    const second = { ...first, ttl: 6, location: "中国 · 北京" };
    expect(foldHops([first, second], true)).toHaveLength(2);
    expect(foldHops([first, { ...first, ttl: 6 }], true)).toHaveLength(1);
  });
  it("separates an independent observation and its failed diagnostics from MTR", () => {
    const data: ReportMeasurement["data"] = { kind: "route", state: "partial", diagnostic: "", hops: [hop],
      metadataObservation: { state: "failed", matchedIps: [], protocol: "tcp", port: 443, exitCode: 1,
        diagnostic: "NextTrace 未返回有效 JSON", stderr: "provider unavailable", stdout: "<unsafe>",
        stdoutTruncated: true, hops: [{ ...hop, rttMs: 120 }] } };
    const html = renderToStaticMarkup(<RouteMetadataObservation data={data} />);
    for (const value of ["补充失败", "退出码", "provider unavailable", "&lt;unsafe&gt;", "（节选）", "120.0", "不参与上方 MTR 统计"])
      expect(html).toContain(value);
    expect(html).not.toContain("699.8");
    expect(renderToStaticMarkup(<RouteMetadataObservation data={{ kind: "route", state: "partial", diagnostic: "" }} />)).toContain("未记录独立 NextTrace");
    expect(renderToStaticMarkup(<RouteMetadataObservation data={{ kind: "route", state: "partial", diagnostic: "", metadataObservation: {method:"nexttrace", matchedIps:[]} }} />)).toContain("旧版报告未保存退出码");
  });
  it("does not present registry country or missing positions as a physical route", () => {
    const html = renderToStaticMarkup(<RoutePathSummary hops={[hop, { ...hop, ttl: 6, asn: "4134", location: "" }]} />);
    expect(html).toContain("未知 → AS4134");
    expect(html).toContain("已知位置标签");
    expect(html).toContain("不代表已验证的物理路径");
    expect(html).not.toContain("GIA");
  });
  it("exports metadata evidence without importing raw tool output into the archive", () => {
    const evidence = JSON.stringify(projectEvidence({ kind:"route", hops:[hop], stdout:"private raw output", metadataObservation:{stderr:"private diagnostic"} }));
    expect(evidence).toContain("CN2-BackBone");
    expect(evidence).toContain("chinatelecom.com.cn");
    expect(evidence).toContain("geoSource");
    expect(evidence).not.toContain("private");
  });
});
