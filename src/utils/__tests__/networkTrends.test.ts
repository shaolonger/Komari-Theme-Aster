import { describe, expect, it } from "vitest";
import { networkTrends } from "../instanceReport/networkTrends";
import type { NetworkEvidence } from "../instanceReport/model";

describe("network report trends", () => {
  it("keeps family, source, city, direction and connection counts separate", () => {
    const base: NetworkEvidence = { id: "1", module: "china-speed", time: 100, state: "ok", target: "", direction: "VPS↔端点", source: "", family: "4", city: "上海", carrier: "电信", provider: "测量点", targetRef: "测点 1", detail: { runs: [
      { streams: 1, vpsDirection: "download", bitsPerSecond: 100000000 },
      { streams: 1, vpsDirection: "upload", bitsPerSecond: 200000000 },
      { streams: 4, vpsDirection: "download", bitsPerSecond: 400000000 },
    ] } };
    const trends = networkTrends([base, { ...base, id: "2", family: "6", time: 200 }, { ...base, id: "failed", time: 200, state: "failed", detail: {} }, { ...base, id: "3", time: 300 }]);
    const rates = trends.filter(t => t.unit === "Mbps");
    expect(rates).toHaveLength(6);
    expect(rates.find(t => t.title.includes("IPv4") && t.title.includes("下载") && t.title.includes("1 连接"))?.points.map(p => p.v)).toEqual([100, null, 100]);
    expect(rates.find(t => t.title.includes("IPv6") && t.title.includes("上传"))?.points[0]?.v).toBe(200);
    expect(trends.find(t => t.unit === "状态")?.points).toHaveLength(4);
  });
  it("renders observed route labels as categories and does not invent unavailable labels", () => {
    const base: NetworkEvidence = { id: "1", module: "routes", time: 100, state: "ok", target: "", source: "", direction: "VPS→大陆", family: "4", carrier: "电信", targetRef: "测点 1", detail: { routeEvidence: { headlineLabels: ["163", "CN2"] } } };
    const trends = networkTrends([base, { ...base, id: "2", time: 200, state: "missing", detail: {} }]);
    const routes = trends.find(t => t.unit === "线路");
    expect(routes?.points.map(p => p.label)).toEqual(["163 / CN2"]);
    expect(trends.find(t => t.unit === "状态")?.points.map(p => p.label)).toEqual(["成功", "缺测"]);
    const old = networkTrends([{ ...base, detail: { asPath: ["AS4134", "AS4809"] }, summaryOnly: true }]);
    expect(old.find(t => t.unit === "线路")?.points[0]?.label).toBe("163 / CN2");
  });
});
