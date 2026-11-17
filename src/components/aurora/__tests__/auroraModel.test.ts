import { describe, expect, it } from "vitest";
import {
  identifyPingSource,
  selectCarrierPing,
  sampleColor,
} from "../auroraModel";
import { buildHomepagePingSourceRows } from "@/utils/homepagePingSources";

describe("Aurora dual-stack matrix", () => {
  it("identifies named carriers and IPv6 without assigning unknown probes to a carrier", () => {
    expect(
      identifyPingSource({
        name: "北京电信 IPv6",
        group: "",
        target: "example.com",
      }),
    ).toEqual({ carrier: "电信", family: "6" });
    expect(
      identifyPingSource({ name: "Unicom", group: "", target: "2001:db8::1" }),
    ).toEqual({ carrier: "联通", family: "6" });
    expect(
      identifyPingSource({ name: "移动", group: "", target: "192.0.2.1:443" }),
    ).toEqual({ carrier: "移动", family: "4" });
    expect(
      identifyPingSource({
        name: "Global probe",
        group: "",
        target: "192.0.2.1",
      }),
    ).toBeNull();
  });
  it("selects the worst measured source within the same carrier and family, leaving missing IPv6 empty", () => {
    const rows = buildHomepagePingSourceRows({
      taskSummaries: [
        {
          taskId: 1,
          name: "电信",
          target: "192.0.2.1",
          lastValue: 180,
          loss: 0,
          sampleCount: 16,
          hasSamples: true,
        },
        {
          taskId: 2,
          name: "电信备用",
          target: "192.0.2.2",
          lastValue: 250,
          loss: 8,
          sampleCount: 16,
          hasSamples: true,
        },
        {
          taskId: 3,
          name: "电信无样本",
          target: "192.0.2.3",
          lastValue: null,
          loss: null,
          sampleCount: 0,
          hasSamples: false,
        },
        {
          taskId: 4,
          name: "移动",
          target: "192.0.2.4",
          lastValue: 300,
          loss: 20,
          sampleCount: 16,
          hasSamples: true,
        },
      ],
    });
    expect(selectCarrierPing(rows, "电信", "4")?.taskId).toBe(2);
    expect(selectCarrierPing(rows, "电信", "6")).toBeUndefined();
    expect(selectCarrierPing(rows, "联通", "4")).toBeUndefined();
    expect(rows.map((row) => row.taskId)).toEqual([1, 2, 3, 4]);
  });
  it("shows failed probes and high loss in red", () => {
    expect(sampleColor(-1)).toBe("#f51f4d");
    expect(sampleColor(180, 15)).toBe("#f51f4d");
    expect(sampleColor(80, 0, true)).toBe("#0baf38");
  });
});
