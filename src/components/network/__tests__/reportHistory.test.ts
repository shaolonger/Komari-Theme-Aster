import { expect, it } from "vitest";
import type { ReportRound } from "@/services/reportObservatory";
import { historyPoint } from "../ReportHistory";

function round(state = "ok", metrics: Record<string, unknown> = {}): ReportRound {
  return { id: "round", plannedAt: "2026-10-22T12:00:00Z", parameters: { family: "4" },
    slots: [{ id: "target", target: "8.8.8.8", state, source: { provider: "owned" }, metrics }], measurements: [] } as unknown as ReportRound;
}
it("keeps failed and absent measurements as gaps instead of zero speed", () => {
  expect(historyPoint(round("failed", { medianMs: 0 }), "target", "median").value).toBeNull();
  expect(historyPoint(round("ok"), "target", "download").value).toBeNull();
  expect(historyPoint(round("ok", { sent: 0, received: 0 }), "target", "failure").value).toBeNull();
});
it("reads retained summaries after raw samples expire and distinguishes direction/stream", () => {
  const saved = round("partial", { sent: 10, received: 8, medianMs: 25,
    runs: [{ streams: 1, vpsDirection: "download", state: "ok", bitsPerSecond: 200e6 },
      { streams: 4, vpsDirection: "download", state: "ok", bitsPerSecond: 900e6 }] });
  expect(historyPoint(saved, "target", "failure").value).toBe(20);
  expect(historyPoint(saved, "target", "median").value).toBe(25);
  expect(historyPoint(saved, "target", "download").value).toBe(200);
  expect(historyPoint(saved, "target", "upload").value).toBeNull();
});
it("breaks comparability when the actual provider node changes", () => {
  const a = round("ok", { actualEndpoint: { id: "a", ip: "8.8.8.8" } });
  const b = round("ok", { actualEndpoint: { id: "b", ip: "1.1.1.1" } });
  expect(historyPoint(a, "target", "median").fingerprint).not.toBe(historyPoint(b, "target", "median").fingerprint);
});
