import { describe, expect, it } from "vitest";
import {
  buildComparisonCsv,
  buildComparisonMarkdown,
  buildComparisonRanking,
  buildComparisonSeries,
  buildMultiMetricComparisonAnalysis,
  buildMultiMetricComparisonCsv,
  buildMultiMetricComparisonMarkdown,
  buildPingTaskVpsCompareUrl,
  buildPingTaskComparisonSeries,
  buildPingTaskVpsComparisonSeries,
  filterPingRecordsByTask,
  formatComparisonValue,
  getComparisonRequestHours,
  getPingTaskBoundNodeUuids,
  isValidComparisonCustomRange,
  mergePingTasksById,
  normalizeComparisonPingTaskId,
  parseComparisonMetricKeys,
  prepareComparisonTrendData,
  sortComparisonRankingRows,
  trimComparisonSeriesToRange,
  type ComparisonNode,
  type ComparisonRankingRow,
  type ComparisonSeries,
} from "@/utils/vpsCompare";
import type { ComparisonLoadRecords } from "@/services/api";
import type { LoadRecord, PingRecord, PingTask } from "@/types/komari";

const nodes: ComparisonNode[] = [
  { uuid: "a", name: "alpha", group: "edge", region: "US" },
  { uuid: "b", name: "beta", group: "edge", region: "JP" },
];

function loadRecord(partial: Partial<LoadRecord>): LoadRecord {
  return {
    cpu: 0,
    gpu: 0,
    ram: 0,
    ram_total: 0,
    swap: 0,
    swap_total: 0,
    load: 0,
    temp: 0,
    disk: 0,
    disk_total: 0,
    net_in: 0,
    net_out: 0,
    net_total_up: 0,
    net_total_down: 0,
    process: 0,
    connections: 0,
    connections_udp: 0,
    time: 0,
    client: "",
    ...partial,
  };
}

function task(partial: Partial<PingTask> & Pick<PingTask, "id">): PingTask {
  const { id, ...rest } = partial;
  return {
    id,
    interval: 60,
    name: "",
    loss: 0,
    clients: [],
    type: "icmp",
    target: "",
    weight: 0,
    ...rest,
  };
}

describe("buildComparisonSeries", () => {
  it("extracts load metrics and ranks by p95 pressure", () => {
    const loadRecords: ComparisonLoadRecords = {
      a: [
        loadRecord({ client: "a", time: 1000, cpu: 10 }),
        loadRecord({ client: "a", time: 2000, cpu: 20 }),
      ],
      b: [
        loadRecord({ client: "b", time: 1000, cpu: 30 }),
        loadRecord({ client: "b", time: 2000, cpu: 40 }),
      ],
    };

    const series = buildComparisonSeries({ metricKey: "cpu", nodes, loadRecords });
    const ranking = buildComparisonRanking(series);

    expect(series[0].points.map((point) => point.value)).toEqual([10, 20]);
    expect(ranking.map((row) => row.uuid)).toEqual(["b", "a"]);
    expect(ranking[0].average).toBe(35);
  });

  it("derives memory percentage from used and total bytes", () => {
    const loadRecords: ComparisonLoadRecords = {
      a: [loadRecord({ client: "a", time: 1000, ram: 512, ram_total: 1024 })],
    };

    const series = buildComparisonSeries({ metricKey: "ram", nodes: nodes.slice(0, 1), loadRecords });

    expect(series[0].points[0].value).toBe(50);
  });

  it("aggregates ping latency and loss separately", () => {
    const pingRecords: PingRecord[] = [
      { client: "a", task_id: 1, time: 1000, value: 20 },
      { client: "a", task_id: 2, time: 1000, value: 40 },
      { client: "a", task_id: 1, time: 2000, value: -1 },
      { client: "b", task_id: 1, time: 1000, value: -1 },
      { client: "b", task_id: 2, time: 1000, value: 10 },
    ];

    const latency = buildComparisonSeries({ metricKey: "ping_latency", nodes, pingRecords });
    const loss = buildComparisonSeries({ metricKey: "ping_loss", nodes, pingRecords });

    expect(latency[0].points.map((point) => point.value)).toEqual([30]);
    expect(loss[0].points.map((point) => point.value)).toEqual([0, 100]);
    expect(loss[1].points.map((point) => point.value)).toEqual([50]);
  });

  it("treats zero-valued ping samples as packet loss, not latency", () => {
    const pingRecords: PingRecord[] = [
      { client: "a", task_id: 1, time: 1000, value: 0 },
      { client: "a", task_id: 2, time: 1000, value: 20 },
    ];

    const latency = buildComparisonSeries({ metricKey: "ping_latency", nodes, pingRecords });
    const loss = buildComparisonSeries({ metricKey: "ping_loss", nodes, pingRecords });

    expect(latency[0].points.map((point) => point.value)).toEqual([20]);
    expect(loss[0].points.map((point) => point.value)).toEqual([50]);
  });

  it("splits one VPS ping records into task-level comparison series", () => {
    const series = buildPingTaskComparisonSeries({
      metricKey: "ping_latency",
      node: nodes[0],
      tasks: [task({ id: 1, name: "Google" }), task({ id: 2, name: "Cloudflare" })],
      taskIds: [2, 1],
      records: [
        { client: "a", task_id: 1, time: 1000, value: 20 },
        { client: "a", task_id: 2, time: 1000, value: 80 },
        { client: "b", task_id: 1, time: 1000, value: 500 },
      ],
    });

    expect(series.map((item) => item.name)).toEqual(["Google", "Cloudflare"]);
    expect(series.map((item) => item.uuid)).toEqual(["a:ping:1", "a:ping:2"]);
    expect(series.map((item) => item.points[0]?.value)).toEqual([20, 80]);
  });

  it("filters multi-VPS ping comparison to one task", () => {
    const pingRecords: PingRecord[] = [
      { client: "a", task_id: 1, time: 1000, value: 20 },
      { client: "a", task_id: 2, time: 1000, value: 80 },
      { client: "b", task_id: 1, time: 1000, value: 30 },
      { client: "b", task_id: 2, time: 1000, value: 10 },
    ];

    const series = buildPingTaskVpsComparisonSeries({
      metricKey: "ping_latency",
      nodes,
      records: pingRecords,
      taskId: 2,
    });

    expect(series.map((item) => item.uuid)).toEqual(["a", "b"]);
    expect(series.map((item) => item.points[0]?.value)).toEqual([80, 10]);
    expect(filterPingRecordsByTask(pingRecords, 1).map((record) => record.value)).toEqual([20, 30]);
  });
});

describe("parseComparisonMetricKeys", () => {
  it("parses metrics url values with dedupe and fallback", () => {
    expect(parseComparisonMetricKeys("cpu,ram,cpu,ping_loss", "disk")).toEqual(["cpu", "ram", "ping_loss"]);
    expect(parseComparisonMetricKeys("bad,,unknown", "disk")).toEqual(["disk"]);
    expect(parseComparisonMetricKeys(null, "ping_latency")).toEqual(["ping_latency"]);
  });
});

describe("buildMultiMetricComparisonAnalysis", () => {
  it("builds a ranked VPS x metric matrix from load and ping metrics", () => {
    const analysis = buildMultiMetricComparisonAnalysis({
      metricKeys: ["cpu", "ping_loss"],
      nodes,
      loadRecordsByMetric: {
        cpu: {
          a: [loadRecord({ client: "a", time: 1000, cpu: 20 })],
          b: [loadRecord({ client: "b", time: 1000, cpu: 82 })],
        },
      },
      pingRecords: [
        { client: "a", task_id: 1, time: 1000, value: 20 },
        { client: "b", task_id: 1, time: 1000, value: 0 },
        { client: "b", task_id: 2, time: 1000, value: 30 },
      ],
    });

    expect(analysis.metricKeys).toEqual(["cpu", "ping_loss"]);
    expect(analysis.rows.map((row) => row.uuid)).toEqual(["b", "a"]);
    expect(analysis.rows[0].cells.cpu?.riskTone).toBe("critical");
    expect(analysis.rows[0].cells.ping_loss?.stats.p95).toBe(50);
    expect(analysis.rows[0].cells.ping_loss?.tags).toContain("丢包");
    expect(analysis.rows[0].worstCell?.metric.key).toBe("ping_loss");
    expect(analysis.insights[0]?.label).toBe("综合最差");
  });

  it("filters ping records by task in multi-metric mode", () => {
    const analysis = buildMultiMetricComparisonAnalysis({
      metricKeys: ["ping_latency", "ping_loss"],
      nodes: nodes.slice(0, 1),
      pingTaskId: 2,
      pingRecords: [
        { client: "a", task_id: 1, time: 1000, value: 500 },
        { client: "a", task_id: 2, time: 1000, value: 0 },
        { client: "a", task_id: 2, time: 2000, value: 40 },
      ],
    });

    expect(analysis.rows[0].cells.ping_latency?.stats.average).toBe(40);
    expect(analysis.rows[0].cells.ping_loss?.stats.average).toBe(50);
  });

  it("exports multi-metric ranking as csv and markdown", () => {
    const analysis = buildMultiMetricComparisonAnalysis({
      metricKeys: ["cpu", "ram"],
      nodes: [nodes[0]],
      loadRecordsByMetric: {
        cpu: { a: [loadRecord({ client: "a", time: 1000, cpu: 70 })] },
        ram: { a: [loadRecord({ client: "a", time: 1000, ram: 768, ram_total: 1024 })] },
      },
    });

    expect(buildMultiMetricComparisonCsv(analysis)).toContain("CPU_primary");
    expect(buildMultiMetricComparisonCsv(analysis)).toContain("alpha");
    expect(buildMultiMetricComparisonMarkdown(analysis)).toContain("VPS 多指标对比");
    expect(buildMultiMetricComparisonMarkdown(analysis)).toContain("70.00% / 70");
  });
});

describe("ping task VPS compare helpers", () => {
  it("normalizes a single ping task id", () => {
    expect(normalizeComparisonPingTaskId("2")).toBe(2);
    expect(normalizeComparisonPingTaskId(5)).toBe(5);
    expect(normalizeComparisonPingTaskId("0")).toBeNull();
    expect(normalizeComparisonPingTaskId("abc")).toBeNull();
  });

  it("derives visible bound VPS uuids for one ping task", () => {
    expect(
      getPingTaskBoundNodeUuids(
        {
          2: ["b", "a", "a"],
          5: ["c"],
        },
        2,
        ["a", "b"],
      ),
    ).toEqual(["b", "a"]);
    expect(getPingTaskBoundNodeUuids({ 2: ["a"] }, null)).toEqual([]);
  });

  it("builds a compare URL for one ping task across VPS nodes", () => {
    expect(
      buildPingTaskVpsCompareUrl({
        taskId: 2,
        nodes: ["b", "a", "a", ""],
        metricKey: "ping_loss",
        hours: 12,
        view: "ranking",
      }),
    ).toBe("/compare?metric=ping_loss&hours=12&tab=ranking&nodes=b%2Ca&pingTask=2");
  });

  it("prefers complete ping task metadata over fallback task labels", () => {
    const taskById = mergePingTasksById([
      [task({ id: 12, name: "广州电信", target: "example.com" })],
      [task({ id: 12, name: "任务 #12", target: "" })],
    ]);

    expect(taskById.get(12)?.name).toBe("广州电信");
    expect(taskById.get(12)?.target).toBe("example.com");
  });
});

describe("prepareComparisonTrendData", () => {
  const trendSeries: ComparisonSeries[] = [
    {
      uuid: "a",
      name: "alpha",
      group: "edge",
      region: "US",
      points: [
        { time: 0, value: 20 },
        { time: 60, value: 24 },
      ],
    },
    {
      uuid: "b",
      name: "beta",
      group: "edge",
      region: "JP",
      points: [
        { time: 30, value: 120 },
        { time: 90, value: 128 },
      ],
    },
  ];

  it("buckets off-phase ping samples onto a shared time grid", () => {
    const trend = prepareComparisonTrendData({
      metricKey: "ping_latency",
      series: trendSeries,
      hours: 1,
      start: 0,
      end: 120,
    });

    expect(trend.bucketSeconds).toBe(60);
    expect(trend.times).toEqual([0, 60, 120]);
    expect(trend.valuesBySeries[0]).toEqual([20, 24, undefined]);
    expect(trend.valuesBySeries[1]).toEqual([120, 128, undefined]);
  });

  it("keeps real long ping gaps as chart breaks", () => {
    const trend = prepareComparisonTrendData({
      metricKey: "ping_latency",
      series: [
        {
          uuid: "a",
          name: "alpha",
          group: "",
          region: "",
          points: [
            { time: 0, value: 20 },
            { time: 60, value: 21 },
            { time: 600, value: 30 },
          ],
        },
      ],
      hours: 1,
      start: 0,
      end: 660,
    });

    expect(trend.valuesBySeries[0]).toContain(null);
  });

  it("lightly smooths dense ping jitter without changing raw ranking samples", () => {
    const trend = prepareComparisonTrendData({
      metricKey: "ping_latency",
      series: [
        {
          uuid: "a",
          name: "alpha",
          group: "",
          region: "",
          points: [
            { time: 0, value: 200 },
            { time: 60, value: 320 },
            { time: 120, value: 210 },
            { time: 180, value: 310 },
            { time: 240, value: 205 },
          ],
        },
      ],
      hours: 1,
      start: 0,
      end: 300,
    });

    expect(trend.smoothWindow).toBeGreaterThan(1);
    expect(trend.rawSamples).toBe(5);
    expect(trend.valuesBySeries[0][1]).toBeLessThan(320);
  });
});

describe("comparison custom ranges", () => {
  it("validates start/end ordering", () => {
    expect(isValidComparisonCustomRange(100, 200)).toBe(true);
    expect(isValidComparisonCustomRange(200, 100)).toBe(false);
    expect(isValidComparisonCustomRange(null, 200)).toBe(false);
  });

  it("computes a compatible hours window from now back to custom start", () => {
    expect(
      getComparisonRequestHours({
        presetHours: 4,
        customStart: 1_000,
        customEnd: 2_000,
        nowSeconds: 8_200,
      }),
    ).toBe(2);
    expect(
      getComparisonRequestHours({
        presetHours: 4,
        customStart: 1_000,
        customEnd: 2_000,
        nowSeconds: 20_000,
        maxHours: 3,
      }),
    ).toBe(3);
  });

  it("trims series points to the chosen custom range", () => {
    const trimmed = trimComparisonSeriesToRange(
      [
        {
          uuid: "a",
          name: "alpha",
          group: "",
          region: "",
          points: [
            { time: 50, value: 1 },
            { time: 100, value: 2 },
            { time: 150, value: 3 },
          ],
        },
      ],
      { start: 75, end: 125 },
    );

    expect(trimmed[0].points).toEqual([{ time: 100, value: 2 }]);
  });
});

describe("comparison export helpers", () => {
  it("formats values for display and exports ranking rows", () => {
    const rows = [
      {
        uuid: "a",
        name: "alpha, one",
        group: "edge",
        region: "US",
        samples: 2,
        average: 12.3456,
        min: 10,
        max: 20,
        p95: 19.5,
        latest: 20,
      },
    ];

    expect(formatComparisonValue("cpu", 12.3456)).toBe("12.35%");
    expect(formatComparisonValue("ping_latency", 12.3456)).toBe("12.35 ms");
    expect(formatComparisonValue("ping_loss", 0.3456)).toBe("0.35%");
    expect(buildComparisonCsv(rows, "cpu")).toContain('"alpha, one"');
    expect(buildComparisonMarkdown(rows, "cpu")).toContain("VPS 对比 - CPU 使用率");
  });
});

describe("comparison ranking sorting", () => {
  const rows: ComparisonRankingRow[] = [
    {
      uuid: "b",
      name: "beta",
      group: "",
      region: "JP",
      samples: 8,
      average: 20,
      min: 1,
      max: 60,
      p95: 40,
      latest: null,
    },
    {
      uuid: "a",
      name: "alpha",
      group: "edge",
      region: "US",
      samples: 12,
      average: 30,
      min: 1,
      max: 80,
      p95: 70,
      latest: 15,
    },
    {
      uuid: "c",
      name: "gamma",
      group: "core",
      region: "",
      samples: 10,
      average: 10,
      min: 1,
      max: 20,
      p95: 25,
      latest: 8,
    },
  ];

  it("sorts text and numeric ranking columns by the requested direction", () => {
    expect(sortComparisonRankingRows(rows, "name", "asc").map((row) => row.uuid)).toEqual(["a", "b", "c"]);
    expect(sortComparisonRankingRows(rows, "p95", "desc").map((row) => row.uuid)).toEqual(["a", "b", "c"]);
    expect(sortComparisonRankingRows(rows, "latest", "asc").map((row) => row.uuid)).toEqual(["c", "a", "b"]);
  });

  it("keeps empty text values and missing numeric values at the end", () => {
    expect(sortComparisonRankingRows(rows, "group", "desc").map((row) => row.uuid)).toEqual(["a", "c", "b"]);
    expect(sortComparisonRankingRows(rows, "latest", "desc").map((row) => row.uuid)).toEqual(["a", "c", "b"]);
  });
});
