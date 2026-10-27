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
import { RpcResponseError, RpcTransportError } from "@/services/rpc2Client";

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
  it("archives every GPU device separately, preserves negative temperatures and delta provenance", async () => {
    expect(
      forkMetrics({ records: [{ time: start, temp: -2 }] }, "a", range).find(
        (m) => m.key === "temp",
      )?.points[0]?.v,
    ).toBe(-2);
    call.mockResolvedValue({
      series: [
        {
          entity_id: "a",
          metric_key: "gpu.memory.used",
          downsampled: false,
          interval_seconds: 60,
          retention_days: 7,
          points: [
            {
              time: start,
              value: 0,
              count: 1,
              tags: { device_index: "0", device_name: "GPU A" },
            },
            {
              time: start,
              value: 2048,
              count: 1,
              tags: { device_index: "1", device_name: "GPU B" },
            },
          ],
        },
        {
          entity_id: "a",
          metric_key: "gpu.temperature",
          points: [
            {
              time: start,
              value: -4,
              count: 1,
              tags: { device_index: "0", device_name: "GPU A" },
            },
          ],
        },
        {
          entity_id: "a",
          metric_key: "traffic.up",
          downsampled: true,
          points: [{ time: start, value: 0, count: 10 }],
        },
      ],
    });
    const result = await collectMetrics(
      "a",
      range,
      new AbortController().signal,
    );
    const devices = result.metrics.filter((m) =>
      m.key.startsWith("gpu_memory["),
    );
    expect(devices).toHaveLength(2);
    expect(devices.map((m) => m.points[0]!.v)).toEqual([0, 2048]);
    expect(devices[0]!.provenance).toMatchObject({
      deviceIndex: "0",
      deviceName: "GPU A",
      downsampled: false,
      retentionDays: 7,
    });
    expect(
      result.metrics.find((m) => m.key.startsWith("temp["))!.points[0]!.v,
    ).toBe(-4);
    expect(
      result.metrics.find((m) => m.key === "traffic_delta_up")!.provenance
        ?.aggregation,
    ).toBe("avg");
    expect(call).toHaveBeenCalledWith(
      "public:queryMetrics",
      expect.objectContaining({
        metric_keys: expect.arrayContaining([
          "gpu.usage",
          "gpu.device.usage",
          "gpu.memory.used",
          "gpu.memory.total",
          "gpu.temperature",
          "traffic.up",
          "traffic.down",
        ]),
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

describe("long report history", () => {
  beforeEach(() => { profile.mockReset().mockResolvedValue({ kind: "fork-v2.4" }); call.mockReset(); });
  afterEach(() => vi.unstubAllGlobals());
  it("preserves supported official metrics when an older server rejects an unknown metric", async () => {
    profile.mockResolvedValue({ kind: "official-v1.4" });
    call.mockImplementation(async (_method: string, params: { metric_keys: string[] }) => {
      if (params.metric_keys.includes("gpu.temperature")) throw new RpcResponseError("unknown metric key: gpu.temperature", -32602);
      return { series: params.metric_keys.includes("cpu.usage") ? [{ entity_id: "a", metric_key: "cpu.usage", points: [{ time: start, value: 4, count: 1 }] }] : [] };
    });
    const result = await collectMetrics("a", range, new AbortController().signal);
    expect(result.metrics.find(m => m.key === "cpu")?.points[0]?.v).toBe(4);
    expect(result.source.state).toBe("partial");
    expect(result.source.detail).toContain("gpu.temperature");
  });
  it("queries all history from the epoch then refines rollups to the earliest available data", async () => {
    profile.mockResolvedValue({ kind: "official-v1.4" });
    call.mockImplementation(async (method: string, params: { metric_keys?: string[] }) => {
      if (method === "public:getPublicPingTasks") return [];
      return { series: params.metric_keys?.includes("cpu.usage") ? [{ entity_id: "a", metric_key: "cpu.usage", points: [{ time: start, value: 10, count: 1 }] }] : [] };
    });
    vi.stubGlobal("fetch", vi.fn(async (path: string) => path.endsWith("/capabilities") ? Response.json({ schema: 3, modules: [], retention: {} }) : new Response("{}", { status: 404 })));
    const result = await collectReportInput({ meta, range: { ...range, start: 0, allHistory: true }, theme: "light", showAddresses: false, compare: false, loggedIn: false }, new AbortController().signal, () => {});
    expect(result.range.start).toBe(start - 86400000);
    const resourceQueries = call.mock.calls.filter(([method, params]) => method === "public:queryMetrics" && params.metric_keys.includes("cpu.usage"));
    expect(resourceQueries).toHaveLength(2);
    expect(resourceQueries[0]![1].start).toBe("1970-01-01T00:00:00.000Z");
    expect(resourceQueries[1]![1].start).toBe(new Date(start - 86400000).toISOString());
  });
  it("splits capped fork responses and retains both halves without boundary duplication", async () => {
    call.mockImplementation(async (_method: string, params: { start: string; end: string }) => {
      const a = Date.parse(params.start), b = Date.parse(params.end);
      if (b - a === 3600000) return { records: Array.from({ length: 20000 }, () => ({ time: a, cpu: 1 })), count: 22000 };
      return { records: [{ time: a, cpu: a === start ? 1 : 2 }, { time: b, cpu: 99 }], count: 2 };
    });
    const result = await collectMetrics("a", range, new AbortController().signal);
    expect(call).toHaveBeenCalledTimes(3);
    expect(result.metrics.find(m => m.key === "cpu")?.points.map(p => p.v)).toEqual([1, 2]);
    expect(result.source.state).toBe("available");
  });
  it("reads the fork's recent load tail separately and uses integer-safe explicit dates", async () => {
    const now = Date.now(), longRange = { start: now - 24 * 3600000, end: now - 1000, timeZone: "UTC" };
    call.mockImplementation(async (_method: string, params: { start: string; end: string; hours?: number }) => ({
      records: [{ time: params.start, cpu: Date.parse(params.start) > now - 5 * 3600000 ? 42 : 12 }], count: 1,
    }));
    const result = await collectMetrics("a", longRange, new AbortController().signal);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls.every(([, params]) => params.hours === undefined)).toBe(true);
    expect(result.metrics.find(m => m.key === "cpu")?.points.map(p => p.v)).toEqual([12, 42]);
    expect(call.mock.calls[1]![1].end).toBe(call.mock.calls[0]![1].start);
  });
  it("bounds recent fork reads before asking the server to materialize a long history", async () => {
    const now = Date.now(), longRange = { start: now - 30 * 86400000, end: now - 1000, timeZone: "UTC" };
    call.mockImplementation(async (_method: string, params: { start: string }) => ({ records: [{ time: params.start, cpu: 1 }], count: 1 }));
    await collectMetrics("a", longRange, new AbortController().signal);
    const windows = call.mock.calls.map(([, p]) => ({ start: Date.parse(p.start), end: Date.parse(p.end) })).sort((a, b) => a.start - b.start);
    expect(windows[0]!.start).toBe(longRange.start);
    expect(windows.at(-1)!.end).toBe(longRange.end);
    expect(windows.every(w => w.end - w.start <= 7 * 86400000)).toBe(true);
    expect(windows.slice(1).every((w, i) => w.start === windows[i]!.end)).toBe(true);
  });
  it("keeps target-level route and speed summaries after raw files expire", async () => {
    call.mockImplementation(async (method: string) => method === "public:getPublicPingTasks" ? [] : { series: [] });
    profile.mockResolvedValue({ kind: "official-v1.4" });
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      if (path.endsWith("/capabilities")) return Response.json({ schema: 3, modules: ["routes", "china-speed"], retention: { detailDays: 7, summaryDays: 90 } });
      if (path.includes("history-summary")) {
        const speed = path.includes("china-speed");
        return Response.json({ rounds: [{ id: speed ? "speed" : "route", family: "6", plannedAt: new Date(start).toISOString(), completedAt: new Date(end - 1000).toISOString(), detailAvailable: false,
          slots: [{ id: "slot", state: "ok", completedAt: new Date(end - 1000).toISOString(), target: "203.0.113.5", direction: "VPS→大陆", source: { city: "上海", carrier: "电信", provider: "测试" },
            metrics: speed ? { runs: [{ state: "ok", streams: 1, vpsDirection: "download", bitsPerSecond: 250000000 }] } : { routeEvidence: { headlineLabels: ["CN2"] } } }] }], nextCursor: null });
      }
      return new Response("{}", { status: 404 });
    }));
    const result = await collectReportInput({ meta, range, theme: "light", showAddresses: false, compare: false, loggedIn: false }, new AbortController().signal, () => {});
    expect(result.network).toHaveLength(2);
    expect(result.network.every(e => e.summaryOnly && e.family === "6" && e.city === "上海")).toBe(true);
    expect(JSON.stringify(result.network)).toContain("CN2");
    expect(JSON.stringify(result.network)).toContain("250000000");
    expect(JSON.stringify(result)).not.toContain("203.0.113.5");
    expect(result.sources.find(s => s.id === "network-v3")?.state).toBe("partial");
  });
  it("continues the same module after a round becomes unavailable", async () => {
    profile.mockResolvedValue({ kind: "official-v1.4" });
    call.mockImplementation(async (method: string) => method === "public:getPublicPingTasks" ? [] : { series: [] });
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      if (path.endsWith("/capabilities")) return Response.json({ schema: 3, modules: ["routes"] });
      if (path.includes("history-summary")) return Response.json({ rounds: ["gone", "present"].map(id => ({ id, state: "complete", startedAt: new Date(start).toISOString(), completedAt: new Date(end - 1).toISOString(), detailAvailable: true })), nextCursor: null });
      if (path.endsWith("/rounds/present")) return Response.json({ slots: [], measurements: [{ id: "m", completedAt: new Date(end - 1).toISOString(), data: { state: "ok" } }] });
      return new Response("{}", { status: 404 });
    }));
    const result = await collectReportInput({ meta, range, theme: "light", showAddresses: false, compare: false, loggedIn: false }, new AbortController().signal, () => {});
    expect(result.network).toHaveLength(2);
    expect(result.network.some(e => e.id.includes("present"))).toBe(true);
    expect(result.network.find(e => e.id.includes("gone"))?.summaryOnly).toBe(true);
    expect(result.sources.find(s => s.id === "network-v3")?.detail).toContain("1 个轮次明细不可用");
  });
  it("marks summary-only data when retention expires between list and detail reads", async () => {
    profile.mockResolvedValue({ kind: "official-v1.4" });
    call.mockImplementation(async (method: string) => method === "public:getPublicPingTasks" ? [] : { series: [] });
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      if (path.endsWith("/capabilities")) return Response.json({ schema: 3, modules: ["routes"] });
      if (path.includes("history-summary")) return Response.json({ rounds: [{ id: "r", state: "complete", family: "4", startedAt: new Date(start).toISOString(), completedAt: new Date(end - 1).toISOString(), detailAvailable: true }], nextCursor: null });
      if (path.endsWith("/rounds/r")) return Response.json({ detailAvailable: false, slots: [{ id: "s", state: "ok", completedAt: new Date(end - 1).toISOString(), metrics: { routeEvidence: { headlineLabels: ["CN2"] } } }] });
      return new Response("{}", { status: 404 });
    }));
    const result = await collectReportInput({ meta, range, theme: "light", showAddresses: false, compare: false, loggedIn: false }, new AbortController().signal, () => {});
    expect(result.network[0]?.summaryOnly).toBe(true);
    expect(result.sources.find(s => s.id === "network-v3")?.state).toBe("partial");
  });
});
