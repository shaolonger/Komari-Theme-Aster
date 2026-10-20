import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { call, profile } = vi.hoisted(() => ({
  call: vi.fn(),
  profile: vi.fn(),
}));
vi.mock("@/services/backendProfile", () => ({
  getKomariBackendProfile: profile,
}));
vi.mock("@/services/rpc2Client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/rpc2Client")>()),
  getRpc2Client: () => ({ call }),
}));
import {
  collectMetrics,
  collectPings,
  collectReportInput,
  forkMetrics,
} from "@/services/instanceReport";
import { NodeInfoSchema } from "@/types/komari";
import { RpcTransportError } from "@/services/rpc2Client";

const start = Date.parse("2026-01-01T00:00:00Z"),
  end = start + 3600000;
const range = { start, end, timeZone: "UTC" };
const meta = NodeInfoSchema.parse({ uuid: "a", name: "node" });
describe("strict report data collector", () => {
  beforeEach(() => {
    profile.mockReset().mockResolvedValue({ kind: "official-v1.4" });
    call.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());
  it("preserves absent fields separately from genuine zero in both adapters", async () => {
    const fork = forkMetrics(
      {
        records: [
          { client: "a", time: new Date(start).toISOString(), cpu: 0 },
          { client: "a", time: new Date(end).toISOString(), cpu: 99 },
        ],
      },
      "a",
      range,
    );
    expect(fork.map((m) => m.key)).toEqual(["cpu"]);
    expect(fork[0]!.points).toEqual([{ t: start, v: 0 }]);
    call.mockResolvedValue({
      series: [
        {
          entity_id: "a",
          metric_key: "cpu.usage",
          points: [
            { time: start, value: 0, count: 2 },
            { time: start + 1000, value: null, count: 0 },
          ],
        },
      ],
    });
    const result = await collectMetrics(
      "a",
      range,
      new AbortController().signal,
    );
    expect(result.metrics.map((m) => m.key)).toEqual(["cpu"]);
    expect(result.metrics[0]!.points[1]!.v).toBeNull();
    expect(call).toHaveBeenCalledWith(
      "public:queryMetrics",
      expect.objectContaining({
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        aggregation_by_metric: {
          "net.total.up": "last",
          "net.total.down": "last",
        },
      }),
      expect.anything(),
    );
  });
  it("never falls back to an hours-only HTTP endpoint on old date queries", async () => {
    profile.mockResolvedValue({ kind: "fork-v2.4" });
    call.mockRejectedValue(new RpcTransportError("down"));
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      collectMetrics("a", range, new AbortController().signal),
    ).rejects.toThrow("down");
    expect(fetcher).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledWith(
      "common:getRecords",
      expect.objectContaining({
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        uuid: "a",
      }),
      expect.anything(),
    );
  });
  it("reconstructs valid zero and partial-loss latency and retains deleted task IDs", async () => {
    call.mockImplementation(async (method: string) =>
      method === "public:getPublicPingTasks"
        ? []
        : {
            series: [
              {
                entity_id: "a",
                metric_key: "ping.latency_ms",
                tags: { task_id: "8" },
                points: [
                  { time: start, value: 49.5, count: 2 },
                  { time: start + 1000, value: 0, count: 1 },
                ],
              },
              {
                entity_id: "a",
                metric_key: "ping.loss",
                tags: { task_id: "8" },
                points: [
                  { time: start, value: 0.5, count: 2 },
                  { time: start + 1000, value: 0, count: 1 },
                ],
              },
            ],
          },
    );
    const result = await collectPings("a", range, new AbortController().signal);
    expect(result.pings[0]!.name).toBe("历史任务 #8");
    expect(result.pings[0]!.points.map((p) => [p.v, p.sent, p.lost])).toEqual([
      [100, 2, 1],
      [0, 1, 0],
    ]);
  });
  it("does not fabricate latency when aggregated latency and loss weights differ", async () => {
    call.mockImplementation(async (method: string) =>
      method === "public:getPublicPingTasks"
        ? []
        : {
            series: [
              {
                entity_id: "a",
                metric_key: "ping.latency_ms",
                tags: { task_id: "1" },
                points: [{ time: start, value: 30, count: 3 }],
              },
              {
                entity_id: "a",
                metric_key: "ping.loss",
                tags: { task_id: "1" },
                points: [{ time: start, value: 0.5, count: 2 }],
              },
            ],
          },
    );
    const result = await collectPings("a", range, new AbortController().signal);
    expect(result.pings[0]!.points[0]!.v).toBeNull();
    expect(result.source.state).toBe("partial");
  });
  it("pages all network history, filters the exact range, and only makes read requests", async () => {
    call.mockImplementation(async (method: string) =>
      method === "public:getPublicPingTasks" ? [] : { series: [] },
    );
    const fetcher = vi.fn(async (path: string) => {
      if (path.endsWith("/capabilities"))
        return Response.json({
          schema: 3,
          modules: ["routes"],
          retention: { detailDays: 7, summaryDays: 90 },
        });
      if (path.includes("/rounds?"))
        return Response.json(
          path.includes("cursor=older")
            ? {
                rounds: [
                  {
                    id: "inside",
                    startedAt: new Date(start).toISOString(),
                    completedAt: new Date(end - 1).toISOString(),
                    detailAvailable: true,
                  },
                ],
                nextCursor: null,
              }
            : {
                rounds: [
                  {
                    id: "outside",
                    startedAt: new Date(start - 100000).toISOString(),
                    completedAt: new Date(start - 1000).toISOString(),
                  },
                ],
                nextCursor: "older",
              },
        );
      if (path.endsWith("/rounds/inside"))
        return Response.json({
          parameters: { family: "4" },
          slots: [],
          measurements: [
            {
              id: "m",
              nodeUuid: "a",
              target: "203.0.113.1",
              completedAt: new Date(end - 1).toISOString(),
              startedAt: new Date(start).toISOString(),
              direction: "VPS→目标",
              source: { name: "runner" },
              data: {
                state: "ok",
                hops: [{ ttl: 1, address: "203.0.113.1", token: "SECRET" }],
              },
            },
          ],
        });
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await collectReportInput(
      {
        meta,
        range,
        theme: "light",
        showAddresses: false,
        compare: false,
        loggedIn: false,
      },
      new AbortController().signal,
      () => {},
    );
    expect(result.network).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(JSON.stringify(result)).not.toContain("203.0.113.1");
    expect(
      fetcher.mock.calls.some(([path]) => path.includes("cursor=older")),
    ).toBe(true);
    expect(
      fetcher.mock.calls.some(([path]) => path.includes("/rounds/outside")),
    ).toBe(false);
    for (const [, init] of fetcher.mock.calls as unknown as [
      string,
      RequestInit,
    ][])
      expect(init.method ?? "GET").toBe("GET");
  });
  it("honors cancellation before requesting data", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      collectReportInput(
        {
          meta,
          range,
          theme: "light",
          showAddresses: false,
          compare: false,
          loggedIn: false,
        },
        controller.signal,
        () => {},
      ),
    ).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });
  it("rejects malformed official metric payloads instead of calling them an empty history", async () => {
    call.mockResolvedValue({});
    await expect(
      collectMetrics("a", range, new AbortController().signal),
    ).rejects.toThrow("Schema mismatch");
  });
  it("leaves loss unknown for fork rollups without loss weights", async () => {
    profile.mockResolvedValue({ kind: "fork-v2.4" });
    call.mockResolvedValue({
      records: [{ task_id: 1, time: start, value: 20, sample_count: 100 }],
      tasks: [],
    });
    const result = await collectPings("a", range, new AbortController().signal);
    expect(result.pings[0]!.points[0]!.sent).toBe(0);
    expect(result.source.state).toBe("partial");
  });
  it("keeps other network modules when a module is denied, and works on HTTP without randomUUID", async () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto),
    });
    call.mockImplementation(async (method: string) =>
      method === "public:getPublicPingTasks" ? [] : { series: [] },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        if (path.endsWith("/capabilities"))
          return Response.json({
            schema: 3,
            modules: ["routes", "bgp"],
            retention: {},
          });
        if (path.includes("module=bgp"))
          return new Response("{}", { status: 403 });
        if (path.includes("/rounds?"))
          return Response.json({
            rounds: [
              {
                id: "r",
                startedAt: new Date(start).toISOString(),
                completedAt: new Date(end - 1).toISOString(),
              },
            ],
            nextCursor: null,
          });
        if (path.endsWith("/rounds/r"))
          return Response.json({
            measurements: [
              {
                id: "m",
                completedAt: new Date(end - 1).toISOString(),
                data: { state: "ok" },
              },
            ],
            slots: [],
          });
        return new Response("{}", { status: 404 });
      }),
    );
    const result = await collectReportInput(
      {
        meta,
        range,
        theme: "light",
        showAddresses: false,
        compare: false,
        loggedIn: false,
      },
      new AbortController().signal,
      () => {},
    );
    expect(result.network).toHaveLength(1);
    expect(result.reportId).toMatch(/^rpt-/);
    expect(result.sources.find((s) => s.id === "network-v3")?.state).toBe(
      "partial",
    );
    expect(result.sources.find((s) => s.id === "network-v3")?.detail).toContain(
      "bgp 查询失败（HTTP 403）",
    );
  });
});
