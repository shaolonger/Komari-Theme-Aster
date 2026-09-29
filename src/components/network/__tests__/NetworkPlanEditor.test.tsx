import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { NetworkCatalog, NetworkSchedule } from "@/services/networkObservatory";
import { NetworkPlanEditor } from "../NetworkPlanEditor";

const uuid = "c388e74d-a922-4ae1-bd10-1fb30e2e53de";
const catalog: NetworkCatalog = {
  apiVersion: 2, version: "2026-09-28.2", policies: [], inventory: [], inventoryAt: "", inventoryError: "", nodes: [],
  presets: [
    { id: "china-route", name: "三网路径", description: "", source: "", requirement: "nexttrace", items: [
      { id: "pek_ipv4_4134", name: "北京 电信 163 · IPv4", mode: "route", target: "ipv4.pek-4134.endpoint.nxtrace.org", carrier: "电信 163", region: "北京", intervalMinutes: 1440 },
    ] },
    { id: "throughput", name: "授权 iperf3", description: "", source: "", requirement: "iperf3", items: [], targets: [
      { provider: "Leaseweb", region: "香港", target: "speedtest.hkg12.hk.leaseweb.net", port: 5201 },
    ] },
  ],
};

function plan(mode: NetworkSchedule["mode"]): NetworkSchedule {
  return { id: "single_node_plan", name: "单机检测", mode, target: "custom.example.net", port: 5201, intervalMinutes: mode === "route" ? 360 : 1440, scheduleType: "interval", dailyTimes: [], utcOffsetMinutes: 0, enabled: true, carrier: "", region: "", clients: [uuid], nextRunAt: 0, revision: 0, sourcePolicy: "", customized: false, catalogVersion: "" };
}

describe("单机检测的公开目标入口", () => {
  it("在路径追踪编辑时明确提供公开候选与自定义切换", () => {
    const html = renderToStaticMarkup(createElement(NetworkPlanEditor, { uuid, name: "Tokyo", initial: plan("route"), catalog, pending: false, onSave: () => {} }));
    expect(html).toContain("公开候选");
    expect(html).toContain("自定义主机");
    expect(html).toContain("value=\"custom.example.net\"");
  });

  it("在限速与全速测速中显示候选入口和对应流量说明", () => {
    const html = renderToStaticMarkup(createElement(NetworkPlanEditor, { uuid, name: "Tokyo", initial: plan("throughput"), catalog, pending: false, onSave: () => {} }));
    expect(html).toContain("公开候选");
    expect(html).toContain("10 秒限速上传");
    expect(html).toContain("目标主机");
    const speedtest = renderToStaticMarkup(createElement(NetworkPlanEditor, { uuid, name: "Tokyo", initial: plan("speedtest"), catalog, pending: false, onSave: () => {} }));
    expect(speedtest).toContain("全速双向测试不限制传输速率");
  });

  it("目录不可用时保留手动输入并提示升级插件", () => {
    const html = renderToStaticMarkup(createElement(NetworkPlanEditor, { uuid, name: "Tokyo", initial: plan("route"), pending: false, onSave: () => {} }));
    expect(html).toContain("公开目录暂不可用");
    expect(html).toContain("value=\"custom.example.net\"");
  });
});
