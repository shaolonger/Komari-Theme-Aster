import { useEffect, useMemo, useState } from "react";
import UplotReact from "uplot-react";
import type uPlot from "uplot";
import { Eye, EyeOff, MapPin, RefreshCw, Star } from "lucide-react";
import { usePingRecords } from "@/hooks/useRecords";
import { InstancePanel, InstanceChartLoading } from "./InstancePanel";
import {
  buildChartTooltipHooks,
  colorForSeries,
  createTimeAxisFormatter,
  formatChartCoverageTime,
  getAxisColors,
  toChartSeconds,
  useResponsiveChartSize,
  type ChartTooltipState,
} from "./chartShared";
import {
  choosePingSmoothingWindow,
  cutPeakValues,
  detectTypicalIntervalSeconds,
  downsamplePingAligned,
  insertMetricGapSentinels,
  smoothByCount,
} from "./chartData";
import { latencyHeatColor } from "@/utils/metricTone";
import {
  getPingHistoryPointLimit,
  getPingHistoryQueryHours,
  getPingHistoryWindow,
} from "@/utils/pingHistoryResolution";
import { getPingLossPercent, getPingRecordSampleCounts, isValidPingLatency } from "@/utils/pingSamples";
import { formatLatency, formatMetricNumber, formatPacketLoss } from "@/utils/format";
import { usePreferences } from "@/hooks/usePreferences";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import type { PingRecord } from "@/types/komari";
import type { PingTimeRange } from "@/utils/pingTimeRange";
import type { TimedMetricPoint } from "./chartData";

type PingViewFilter = "focus" | "all" | "anomalies" | "watched";
type PingMetricMode = "rtt" | "loss";
type PingGroupingMode = "none" | "region" | "latency";

function inferTaskRegion(name: string, target: string) {
  const value = `${name} ${target}`.toLowerCase();
  if (/香港|hong ?kong|\bhk\b/.test(value)) return "香港";
  if (/台湾|taiwan|\btw\b/.test(value)) return "台湾";
  if (/日本|japan|\bjp\b/.test(value)) return "日本";
  if (/新加坡|singapore|\bsg\b/.test(value)) return "新加坡";
  if (/韩国|south korea|\bkr\b/.test(value)) return "韩国";
  if (/中国|china|\bcn\b/.test(value)) return "中国大陆";
  if (/欧洲|europe|德国|france|法国|英国|\bde\b|\bgb\b|\buk\b/.test(value)) return "欧洲";
  if (/美国|北美|america|united states|\bus\b|canada|加拿大/.test(value)) return "北美";
  if (/澳大利亚|australia|\bau\b/.test(value)) return "大洋洲";
  return "其他地区";
}

function rgbaSeriesColor(color: string, opacity: number) {
  if (color.startsWith("oklch(")) return color.replace(/\/\s*[\d.]+\s*\)/, `/ ${opacity})`);
  if (color.startsWith("hsl(")) return color.replace(/\)$/, ` / ${opacity})`);
  return color;
}

function weightedPercentileFromSorted(
  sorted: Array<{ value: number; weight: number }>,
  ratio: number,
) {
  if (sorted.length === 0) return null;
  const totalWeight = sorted.reduce((sum, point) => sum + point.weight, 0);
  if (totalWeight <= 0) return null;
  const target = Math.max(1, Math.ceil(totalWeight * ratio));
  let seen = 0;
  for (const point of sorted) {
    seen += point.weight;
    if (seen >= target) return point.value;
  }
  return sorted[sorted.length - 1]?.value ?? null;
}

export function PingChart({
  uuid,
  hours,
  active = true,
  range,
  retentionHours,
}: {
  uuid: string;
  hours: number;
  active?: boolean;
  range?: PingTimeRange;
  retentionHours?: number | null;
}) {
  const queryHours = getPingHistoryQueryHours(hours, retentionHours, Boolean(range));
  const { data, isLoading, error, refetch, dataUpdatedAt } = usePingRecords(
    uuid,
    queryHours,
    active,
    range,
  );
  const { resolvedAppearance } = usePreferences();
  const themeSettings = useThemeSettings();
  const displayTimeZone = themeSettings.displayTimeZone;
  const { w, h, ref: chartSizeRef } = useResponsiveChartSize("wide");
  const [hiddenTasks, setHiddenTasks] = useState<Set<number>>(new Set());
  const [connectNulls, setConnectNulls] = useState(false);
  const [cutPeak, setCutPeak] = useState(false);
  const [smoothLines, setSmoothLines] = useState(true);
  const [viewFilter, setViewFilter] = useState<PingViewFilter>("focus");
  const [metricMode, setMetricMode] = useState<PingMetricMode>("rtt");
  const [groupingMode, setGroupingMode] = useState<PingGroupingMode>("none");
  const [activeGroupFilter, setActiveGroupFilter] = useState("");
  const [watchedTasks, setWatchedTasks] = useState<Set<number>>(new Set());
  const [hoveredTaskId, setHoveredTaskId] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<ChartTooltipState>({
    show: false,
    left: 0,
    top: 0,
    rows: [],
    time: "",
  });
  const isDark = resolvedAppearance === "dark";
  const tasks = useMemo(() => [...(data?.tasks ?? [])].sort((a, b) => a.id - b.id), [data]);
  const taskLabels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      const label = task.name || `任务 #${task.id}`;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return new Map(
      tasks.map((task) => {
        const baseLabel = task.name || `任务 #${task.id}`;
        const label = (counts.get(baseLabel) ?? 0) > 1 ? `${baseLabel} #${task.id}` : baseLabel;
        return [task.id, label] as const;
      }),
    );
  }, [tasks]);
  const taskColors = useMemo(
    () => new Map(tasks.map((task, index) => [task.id, colorForSeries(index, tasks.length)] as const)),
    [tasks],
  );
  const taskKeySet = useMemo(() => new Set(tasks.map((task) => String(task.id))), [tasks]);
  const taskKeys = useMemo(() => tasks.map((task) => String(task.id)), [tasks]);
  const taskIndexById = useMemo(
    () => new Map(tasks.map((task, index) => [task.id, index] as const)),
    [tasks],
  );
  const diagnosticsById = useMemo(() => {
    const recordsByTask = new Map<number, PingRecord[]>();
    for (const record of data?.records ?? []) {
      const rows = recordsByTask.get(record.task_id) ?? [];
      rows.push(record);
      recordsByTask.set(record.task_id, rows);
    }
    const cutoff = Date.now() / 1000 - 3600;
    return new Map(tasks.map((task) => {
      const records = (recordsByTask.get(task.id) ?? []).sort((left, right) => toChartSeconds(left.time) - toChartSeconds(right.time));
      const validRecords = records.filter((record) => isValidPingLatency(record.value));
      const latest = validRecords.at(-1)?.value ?? null;
      const loss = getPingLossPercent(records);
      let recentMin = Number.POSITIVE_INFINITY;
      let recentMax = Number.NEGATIVE_INFINITY;
      let recentCount = 0;
      for (const record of validRecords) {
        if (toChartSeconds(record.time) < cutoff) continue;
        recentMin = Math.min(recentMin, record.value);
        recentMax = Math.max(recentMax, record.value);
        recentCount += 1;
      }
      const recentChange = recentCount > 1 ? recentMax - recentMin : 0;
      const severity = loss != null && loss >= 20 || latest != null && latest >= 1000
        ? "critical"
        : loss != null && loss >= 5 || latest != null && latest >= 300
          ? "warning"
          : "ok";
      const average = validRecords.length > 0 ? validRecords.reduce((sum, record) => sum + record.value, 0) / validRecords.length : null;
      const latencyGroup = average == null ? "暂无延迟" : average < 50 ? "低延迟 · <50 ms" : average <= 150 ? "中延迟 · 50–150 ms" : "高延迟 · >150 ms";
      return [task.id, {
        latest,
        loss,
        recentChange,
        severity,
        regionGroup: inferTaskRegion(task.name, task.target),
        latencyGroup,
      }] as const;
    }));
  }, [data?.records, tasks]);
  const focusTaskIds = useMemo(() => {
    const selected = new Set<number>(watchedTasks);
    for (const [taskId, stats] of diagnosticsById) if (stats.severity !== "ok") selected.add(taskId);
    const mostChanged = [...diagnosticsById.entries()].sort((left, right) => right[1].recentChange - left[1].recentChange)[0];
    if (mostChanged) selected.add(mostChanged[0]);
    return selected;
  }, [diagnosticsById, watchedTasks]);
  const candidateTasks = useMemo(() => tasks.filter((task) => {
    const stats = diagnosticsById.get(task.id);
    if (viewFilter === "all") return true;
    if (viewFilter === "anomalies") return stats?.severity !== "ok";
    if (viewFilter === "watched") return watchedTasks.has(task.id);
    return focusTaskIds.has(task.id);
  }), [diagnosticsById, focusTaskIds, tasks, viewFilter, watchedTasks]);
  const groupCandidateTasks = useMemo(() => candidateTasks.filter((task) => {
    if (!activeGroupFilter) return true;
    const stats = diagnosticsById.get(task.id);
    return (groupingMode === "region" ? stats?.regionGroup : stats?.latencyGroup) === activeGroupFilter;
  }), [activeGroupFilter, candidateTasks, diagnosticsById, groupingMode]);
  const visibleTasks = useMemo(
    () => groupCandidateTasks.filter((task) => !hiddenTasks.has(task.id)),
    [groupCandidateTasks, hiddenTasks],
  );
  const visibleTaskIds = useMemo(() => new Set(visibleTasks.map((task) => task.id)), [visibleTasks]);
  const retentionLimited = !range &&
    retentionHours != null &&
    Number.isFinite(retentionHours) &&
    retentionHours > 0 &&
    hours > retentionHours;
  const displayHours = retentionLimited ? queryHours : hours;

  useEffect(() => {
    setHiddenTasks(new Set());
    setViewFilter("focus");
    setHoveredTaskId(null);
    setActiveGroupFilter("");
  }, [uuid]);

  useEffect(() => setActiveGroupFilter(""), [groupingMode]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(`aster-ping-watch:${uuid}`) ?? "[]");
      const valid = new Set<number>(Array.isArray(stored) ? stored.filter((id): id is number => Number.isInteger(id) && tasks.some((task) => task.id === id)) : []);
      setWatchedTasks(valid);
    } catch {
      setWatchedTasks(new Set());
    }
  }, [tasks, uuid]);

  useEffect(() => {
    setHiddenTasks((prev) => {
      const validTaskIds = new Set(tasks.map((task) => task.id));
      const next = new Set([...prev].filter((taskId) => validTaskIds.has(taskId)));
      return next.size === prev.size ? prev : next;
    });
  }, [tasks]);

  const chart = useMemo(() => {
    // 为每个 task 构建完整的对齐序列。显隐通过每条 series 的 `show` 标志 (以及渲染门控)
    // 实现，所以切换某条线不会重跑这套分桶流程。
    if (!data?.records.length || !tasks.length) return null;
    const pointMap = new Map<number, TimedMetricPoint>();
    const lossBuckets = new Map<number, Map<number, { total: number; lost: number }>>();
    const sortedRecords = data.records
      .map((record) => ({
        record,
        time: toChartSeconds(record.time),
      }))
      .filter(({ time }) => time > 0)
      .sort((left, right) => left.time - right.time);
    const taskIntervals = tasks
      .map((task) => task.interval)
      .filter((value): value is number => typeof value === "number" && value > 0);
    const fallbackInterval = taskIntervals.length > 0
      ? Math.min(...taskIntervals)
      : detectTypicalIntervalSeconds(sortedRecords.map(({ time }) => time), 60);
    const tolerance = Math.min(6, Math.max(0.8, fallbackInterval * 0.25));

    // records 已按时间排序，且 anchor 之间间距总是大于 `tolerance` (只有当现有 anchor 都不
    // 在容差内才会新建)，所以一条 record 至多匹配一个 anchor，且必为最近的那个。这样就是 O(n)
    // 合并，而非原来的 O(records × anchors)。
    let lastAnchor = Number.NEGATIVE_INFINITY;
    for (const { record, time } of sortedRecords) {
      if (!taskKeySet.has(String(record.task_id))) continue;
      const anchor = time - lastAnchor <= tolerance ? lastAnchor : time;
      if (anchor === time) lastAnchor = time;
      const current = pointMap.get(anchor) ?? { time: anchor };
      current[String(record.task_id)] = isValidPingLatency(record.value) ? record.value : null;
      pointMap.set(anchor, current);
      const counts = getPingRecordSampleCounts(record);
      const perTask = lossBuckets.get(anchor) ?? new Map<number, { total: number; lost: number }>();
      const currentLoss = perTask.get(record.task_id) ?? { total: 0, lost: 0 };
      currentLoss.total += counts.total;
      currentLoss.lost += counts.lost;
      perTask.set(record.task_id, currentLoss);
      lossBuckets.set(anchor, perTask);
    }

    let chartPoints = [...pointMap.values()].sort((a, b) => a.time - b.time);
    if (cutPeak && taskKeys.length > 0) {
      chartPoints = cutPeakValues(chartPoints, taskKeys);
    }
    const intervals = new Map(
      tasks
        .filter((task) => typeof task.interval === "number" && task.interval > 0)
        .map((task) => [String(task.id), task.interval] as const),
    );
    for (const [anchor, perTask] of lossBuckets) {
      const point = pointMap.get(anchor);
      if (!point) continue;
      for (const [taskId, counts] of perTask) {
        point[`loss_${taskId}`] = counts.total > 0 ? (counts.lost / counts.total) * 100 : null;
      }
    }
    const lossPoints = [...lossBuckets.keys()]
      .map((anchor) => pointMap.get(anchor))
      .filter((point): point is TimedMetricPoint => point != null)
      .sort((left, right) => left.time - right.time);
    const latencyWithGaps = insertMetricGapSentinels(chartPoints, {
      intervals,
      defaultInterval: fallbackInterval,
      matchToleranceRatio: 0.25,
      inferSamplingInterval: true,
    });
    const lossWithGaps = insertMetricGapSentinels(lossPoints, {
      intervals,
      defaultInterval: fallbackInterval,
      matchToleranceRatio: 0.25,
      inferSamplingInterval: true,
    });
    const lossKeys = taskKeys.map((key) => `loss_${key}`);
    const toAlignedData = (points: TimedMetricPoint[], keys: string[]) => {
      const times = points.map((point) => point.time);
      const perTask = keys.map((key) => points.map((point) => point[key]));
      const reduced = downsamplePingAligned(times, perTask, getPingHistoryPointLimit(queryHours));
      const series = smoothLines
        ? smoothByCount(reduced.perTask, choosePingSmoothingWindow(reduced.times, false))
        : reduced.perTask;
      return [reduced.times, ...series] as uPlot.AlignedData;
    };

    return {
      rtt: toAlignedData(latencyWithGaps, taskKeys),
      loss: toAlignedData(lossWithGaps, lossKeys),
    };
  }, [cutPeak, data, queryHours, smoothLines, taskKeySet, taskKeys, tasks]);
  const metricChart = chart?.[metricMode] ?? null;
  const anomalyIntervals = useMemo(() => {
    const intervalByTask = new Map(tasks.map((task) => [task.id, Math.max(1, task.interval || 60)]));
    const windows: Array<[number, number]> = [];
    for (const record of data?.records ?? []) {
      if (!visibleTaskIds.has(record.task_id)) continue;
      const counts = getPingRecordSampleCounts(record);
      const lossPercent = counts.total > 0 ? (counts.lost / counts.total) * 100 : 0;
      const anomalous = metricMode === "loss"
        ? lossPercent >= 5
        : lossPercent >= 5 || isValidPingLatency(record.value) && record.value >= 300;
      if (!anomalous) continue;
      const start = toChartSeconds(record.time);
      const end = start + (intervalByTask.get(record.task_id) ?? 60);
      if (start > 0) windows.push([start, end]);
    }
    windows.sort((left, right) => left[0] - right[0]);
    const merged: Array<[number, number]> = [];
    for (const current of windows) {
      const previous = merged.at(-1);
      if (previous && current[0] <= previous[1] + 5) previous[1] = Math.max(previous[1], current[1]);
      else merged.push([...current]);
    }
    return merged;
  }, [data?.records, metricMode, tasks, visibleTaskIds]);

  const chartWindow = useMemo(() => {
    const timestamps = metricChart?.[0] ?? [];
    const latestSample = timestamps.length > 0
      ? timestamps[timestamps.length - 1]
      : null;
    return getPingHistoryWindow({
      requestedHours: displayHours,
      explicitStart: range ? toChartSeconds(range.start) : null,
      explicitEnd: range ? toChartSeconds(range.end) : null,
      responseEnd: data?.to != null ? toChartSeconds(data.to) : null,
      latestSample: typeof latestSample === "number" ? latestSample : null,
    });
  }, [data?.to, displayHours, metricChart, range]);

  const retainedCoverage = useMemo(() => {
    if (!metricChart || metricChart[0].length === 0) return null;
    const first = metricChart[0][0];
    const last = metricChart[0][metricChart[0].length - 1];
    if (typeof first !== "number" || typeof last !== "number") return null;
    return { first, last };
  }, [metricChart]);

  const yRange = useMemo<[number | null, number | null]>(() => {
    if (!metricChart) return [null, null];
    if (metricMode === "loss") return [0, 100];
    // 单次遍历求 min/max——避免分配扁平化的值数组，也避免 `Math.min(...values)` 展开
    // (大数组会抛 RangeError)。
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < tasks.length; index += 1) {
      if (!visibleTaskIds.has(tasks[index].id)) continue;
      const series = metricChart[index + 1] as Array<number | null | undefined> | undefined;
      if (!series) continue;
      for (const value of series) {
        if (typeof value === "number" && Number.isFinite(value)) {
          if (value < min) min = value;
          if (value > max) max = value;
        }
      }
    }
    if (min === Number.POSITIVE_INFINITY) return [0, 100];
    if (min === max) {
      const pad = Math.max(5, min * 0.1);
      return [Math.max(0, min - pad), max + pad];
    }
    const pad = Math.max(5, (max - min) * 0.12);
    return [Math.max(0, min - pad), max + pad];
  }, [metricChart, metricMode, tasks, visibleTaskIds]);

  // 除 width/height 外的全部配置。uplot-react 会剥掉 width/height，当两次渲染只有它们不同时
  // 调 u.setSize() 而非重建 chart。让其余配置在 resize 间保持引用稳定，拖拽改尺寸就只是廉价的
  // setSize 调用而非整体拆建。(显隐/范围变化仍会重建——那种情况少且是点击触发。)
  const baseOptions = useMemo<Omit<uPlot.Options, "width" | "height"> | null>(() => {
    if (!metricChart) return null;
    const { grid, text } = getAxisColors(isDark);
    const tooltipHooks = buildChartTooltipHooks({
      rangeHours: displayHours,
      displayTimeZone,
      estimatedWidth: 196,
      // Refuse long-distance snapping after drag-zooming or when a custom
      // range contains an empty section.
      maxSnapDistancePx: 28,
      setTooltip,
      buildRows: (idx, currentData) =>
        visibleTasks
          .map((task) => {
            const taskIndex = taskIndexById.get(task.id) ?? 0;
            const raw = currentData[taskIndex + 1]?.[idx] as number | null | undefined;
            return {
              label: taskLabels.get(task.id) ?? `任务 #${task.id}`,
              raw: typeof raw === "number" && Number.isFinite(raw) ? raw : null,
              color: taskColors.get(task.id) ?? colorForSeries(taskIndex, tasks.length),
            };
          })
          // 按当前点的延迟从高到低排序，与图上线条自上而下的视觉顺序一致；无数据(—)沉底。
          .sort((a, b) => {
            if (a.raw == null) return b.raw == null ? 0 : 1;
            if (b.raw == null) return -1;
            return b.raw - a.raw;
          })
          .map(({ label, raw, color }) => ({
            label,
            value: raw == null ? "—" : metricMode === "rtt" ? formatLatency(raw) : formatPacketLoss(raw),
            color,
          })),
    });
    return {
      padding: [10, 14, 12, 2],
      cursor: { drag: { x: true, y: false } },
      legend: { show: false },
      scales: {
        x: {
          time: true,
          ...(chartWindow ? { auto: false, range: chartWindow } : {}),
        },
        y: { auto: false, range: yRange },
      },
      axes: [
        {
          stroke: text,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          size: 36,
          values: createTimeAxisFormatter(displayHours, displayTimeZone),
        },
        {
          stroke: text,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          size: 82,
          values: (_self, splits) => splits.map((value) => (value === 0 && metricMode === "rtt" ? "" : metricMode === "rtt" ? formatLatency(value) : formatPacketLoss(value))),
        },
      ],
      series: [
        { label: "time" },
        ...tasks.map((task, index) => ({
          label: taskLabels.get(task.id) ?? `任务 #${task.id}`,
          stroke: rgbaSeriesColor(
            taskColors.get(task.id) ?? colorForSeries(index, tasks.length),
            hoveredTaskId == null
              ? viewFilter === "all" && diagnosticsById.get(task.id)?.severity === "ok" ? 0.2 : 0.88
              : hoveredTaskId === task.id ? 1 : 0.14,
          ),
          width: hoveredTaskId === task.id ? 2.7 : diagnosticsById.get(task.id)?.severity !== "ok" ? 2.1 : 1.5,
          spanGaps: connectNulls,
          show: visibleTaskIds.has(task.id),
          points: { show: false },
        })),
      ],
      hooks: {
        init: [tooltipHooks.onInit],
        setCursor: [tooltipHooks.onSetCursor],
        draw: [(plot) => {
          if (anomalyIntervals.length === 0) return;
          const context = plot.ctx;
          context.save();
          context.fillStyle = isDark ? "rgba(216, 78, 69, 0.12)" : "rgba(194, 60, 60, 0.075)";
          for (const [start, end] of anomalyIntervals) {
            const left = Math.max(plot.bbox.left, plot.valToPos(start, "x", true));
            const right = Math.min(plot.bbox.left + plot.bbox.width, plot.valToPos(end, "x", true));
            if (right > left) context.fillRect(left, plot.bbox.top, right - left, plot.bbox.height);
          }
          context.restore();
        }],
      },
    };
  }, [
    chartWindow,
    anomalyIntervals,
    connectNulls,
    diagnosticsById,
    displayTimeZone,
    displayHours,
    metricChart,
    metricMode,
    isDark,
    hoveredTaskId,
    taskColors,
    taskIndexById,
    taskLabels,
    tasks,
    visibleTasks,
    visibleTaskIds,
    viewFilter,
    yRange,
  ]);

  const options = useMemo<uPlot.Options | null>(
    () => (baseOptions ? { ...baseOptions, width: w, height: h } : null),
    [baseOptions, w, h],
  );

  const taskStats = useMemo(() => {
    const grouped = new Map<number, PingRecord[]>();
    for (const record of data?.records ?? []) {
      const bucket = grouped.get(record.task_id);
      if (bucket) bucket.push(record);
      else grouped.set(record.task_id, [record]);
    }

    for (const records of grouped.values()) {
      records.sort((a, b) => toChartSeconds(a.time) - toChartSeconds(b.time));
    }

    return tasks.map((task, index) => {
      const records = grouped.get(task.id) ?? [];
      const positives = records
        .map((record) => ({
          record,
          ...getPingRecordSampleCounts(record),
        }))
        .filter(({ record, valid }) => isValidPingLatency(record.value) && valid > 0)
        .map(({ record, valid }) => ({ value: record.value, weight: valid }))
        .sort((left, right) => left.value - right.value);
      const latest = [...records].reverse().find((record) => {
        const { valid } = getPingRecordSampleCounts(record);
        return isValidPingLatency(record.value) && valid > 0;
      })?.value ?? null;
      const validTotal = positives.reduce((sum, point) => sum + point.weight, 0);
      const avg = validTotal > 0
        ? positives.reduce((sum, point) => sum + point.value * point.weight, 0) / validTotal
        : null;
      const min = positives[0]?.value ?? null;
      const max = positives[positives.length - 1]?.value ?? null;
      const p50 = weightedPercentileFromSorted(positives, 0.5);
      const p99 = weightedPercentileFromSorted(positives, 0.99);
      const volatility = p50 && p99 ? p99 / p50 : null;
      const sampleCount = records.reduce(
        (sum, record) => sum + getPingRecordSampleCounts(record).total,
        0,
      );
      const loss = getPingLossPercent(records);
      const diagnostics = diagnosticsById.get(task.id);
      return {
        ...task,
        latest,
        avg,
        min,
        max,
        p50,
        p99,
        volatility,
        total: sampleCount,
        loss,
        color: taskColors.get(task.id) ?? colorForSeries(index, tasks.length),
        severity: diagnostics?.severity ?? "ok",
        recentChange: diagnostics?.recentChange ?? 0,
        regionGroup: diagnostics?.regionGroup ?? inferTaskRegion(task.name, task.target),
        latencyGroup: diagnostics?.latencyGroup ?? "暂无延迟",
      };
    });
  }, [data, diagnosticsById, taskColors, tasks]);

  const groupedTaskStats = useMemo(() => {
    const candidates = taskStats.filter((task) => candidateTasks.some((candidate) => candidate.id === task.id));
    const groups = new Map<string, typeof candidates>();
    for (const task of candidates) {
      const group = groupingMode === "region"
        ? task.regionGroup
        : groupingMode === "latency"
          ? task.latencyGroup
          : "监控线路";
      const rows = groups.get(group) ?? [];
      rows.push(task);
      groups.set(group, rows);
    }
    return [...groups.entries()].sort((left, right) => left[0].localeCompare(right[0], "zh-CN"));
  }, [candidateTasks, groupingMode, taskStats]);

  const anomalyCount = taskStats.filter((task) => task.severity !== "ok").length;
  const rttStats = taskStats.filter((task) => task.avg != null);
  const lossStats = taskStats.filter((task) => task.loss != null);
  const averageRtt = rttStats.length > 0 ? rttStats.reduce((sum, task) => sum + task.avg!, 0) / rttStats.length : null;
  const averageLoss = lossStats.length > 0 ? lossStats.reduce((sum, task) => sum + task.loss!, 0) / lossStats.length : null;
  const worstTask = [...taskStats].sort((left, right) => {
    const severity = (value: string) => value === "critical" ? 2 : value === "warning" ? 1 : 0;
    return severity(right.severity) - severity(left.severity) || (right.latest ?? -1) - (left.latest ?? -1);
  })[0];

  const toggleTask = (taskId: number) => {
    setHiddenTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const toggleAll = () => {
    setHiddenTasks((prev) => {
      const next = new Set(prev);
      const shouldHide = groupCandidateTasks.some((task) => !next.has(task.id));
      for (const task of groupCandidateTasks) {
        if (shouldHide) next.add(task.id);
        else next.delete(task.id);
      }
      return next;
    });
  };

  const toggleWatched = (taskId: number) => {
    setWatchedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      try {
        localStorage.setItem(`aster-ping-watch:${uuid}`, JSON.stringify([...next]));
      } catch {
        // 收藏只保存在当前会话时不影响图表操作。
      }
      return next;
    });
  };

  if (isLoading) {
    return <InstanceChartLoading title="Ping 图表" />;
  }

  if (!data?.records.length) {
    return (
      <InstancePanel title="Ping 图表">
        <div className="instance-empty" role={error ? "alert" : "status"}>{error ? `Ping 数据加载失败：${error.message}` : "所选时间范围暂无延迟记录"}</div>
        {error && <button className="instance-toggle-button" onClick={() => void refetch()}>重试</button>}
      </InstancePanel>
    );
  }

  return (
    <InstancePanel title="Ping 图表" className="instance-chart-panel instance-ping-panel">
      {error && <div role="alert" className="surface-inset p-3 text-sm">Ping 数据加载失败：{error.message}。请重试或调整查询范围。</div>}
      {retentionLimited && (
        <div className="instance-ping-retention-notice" role="status">
          <strong>历史保留不足</strong>
          <span>
            当前服务端只保留 {retentionHours} 小时 Ping 数据，无法还原所选{hours === 168 ? "7 天" : hours === 720 ? "1 月" : `${hours} 小时`}的更早记录。
            图表已按真实密度放大显示当前可用历史
            {retainedCoverage ? `（${formatChartCoverageTime(retainedCoverage.first, displayTimeZone)} – ${formatChartCoverageTime(retainedCoverage.last, displayTimeZone)}）` : ""}。
            将 Komari 的 Ping 记录保留时长调整到至少 {hours} 小时后，新历史会逐步积累。
          </span>
        </div>
      )}
      <div className="instance-ping-summary" aria-label="Ping 诊断摘要">
        <div><span>监控任务</span><strong>{tasks.length}</strong></div>
        <div data-tone={anomalyCount > 0 ? "warning" : "ok"}><span>异常线路</span><strong>{anomalyCount}</strong></div>
        <div><span>最差线路</span><strong title={worstTask ? taskLabels.get(worstTask.id) : undefined}>{worstTask ? `${taskLabels.get(worstTask.id)} · ${formatLatency(worstTask.latest)}` : "—"}</strong></div>
        <div><span>平均 RTT</span><strong>{averageRtt == null ? "—" : formatLatency(averageRtt)}</strong></div>
        <div><span>平均丢包</span><strong>{averageLoss == null ? "—" : formatPacketLoss(averageLoss)}</strong></div>
      </div>

      <div className="instance-ping-diagnostic-controls">
        <div className="instance-segmented" role="group" aria-label="Ping 线路筛选">
          {([
            ["focus", "诊断重点"],
            ["all", "全部线路"],
            ["anomalies", "仅异常"],
            ["watched", `仅关注${watchedTasks.size ? ` ${watchedTasks.size}` : ""}`],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" data-active={viewFilter === value ? "true" : "false"} aria-pressed={viewFilter === value} onClick={() => setViewFilter(value)}>{label}</button>
          ))}
        </div>
        <div className="instance-segmented" role="group" aria-label="Ping 图表指标">
          {([ ["rtt", "RTT"], ["loss", "丢包"] ] as const).map(([value, label]) => (
            <button key={value} type="button" data-active={metricMode === value ? "true" : "false"} aria-pressed={metricMode === value} onClick={() => setMetricMode(value)}>{label}</button>
          ))}
        </div>
        <label className="instance-ping-group-select">
          <MapPin size={14} aria-hidden="true" />
          <span>分组</span>
          <select value={groupingMode} onChange={(event) => setGroupingMode(event.target.value as PingGroupingMode)} aria-label="Ping 线路分组方式">
            <option value="none">不分组</option>
            <option value="region">按地区分组</option>
            <option value="latency">按延迟分组</option>
          </select>
        </label>
        <button type="button" className="instance-toggle-button" data-active={smoothLines ? "true" : "false"} aria-pressed={smoothLines} onClick={() => setSmoothLines((value) => !value)} title="平滑视图减少短时抖动；原始视图保留采样变化。">
          {smoothLines ? "平滑" : "原始"}
        </button>
        {metricMode === "rtt" && <button type="button" className="instance-toggle-button" data-active={cutPeak ? "true" : "false"} aria-pressed={cutPeak} onClick={() => setCutPeak((value) => !value)} title="对极端尖峰做轻度压制，仅影响图线显示。">削峰</button>}
        <button type="button" className="instance-toggle-button" data-active={connectNulls ? "true" : "false"} aria-pressed={connectNulls} onClick={() => setConnectNulls((value) => !value)} title="关闭时显示采样中断；开启后跨过所有空缺连线。">断点连线</button>
        <button type="button" className="instance-toggle-button" onClick={toggleAll}>
          {groupCandidateTasks.every((task) => hiddenTasks.has(task.id)) ? <Eye size={14} /> : <EyeOff size={14} />}
          {groupCandidateTasks.every((task) => hiddenTasks.has(task.id)) ? "显示当前线路" : "隐藏当前线路"}
        </button>
        <button type="button" className="instance-toggle-button" onClick={() => void refetch()}><RefreshCw size={14} />刷新</button>
      </div>

      <div className="instance-ping-task-groups">
        {groupedTaskStats.map(([group, groupTasks]) => (
          <section key={group} className="instance-ping-task-group" aria-label={group}>
            {groupingMode !== "none" && <h3><button type="button" aria-pressed={activeGroupFilter === group} data-active={activeGroupFilter === group ? "true" : "false"} onClick={() => setActiveGroupFilter((current) => current === group ? "" : group)}>{group}<span>{groupTasks.length}</span>{groupingMode === "latency" && <small>独立缩放</small>}</button></h3>}
            <div className="instance-ping-tasks">
              {groupTasks.map((task) => {
                const visible = visibleTaskIds.has(task.id);
                const watched = watchedTasks.has(task.id);
                const taskName = taskLabels.get(task.id) ?? `任务 #${task.id}`;
                return (
                  <div key={task.id} className="instance-ping-task-row" data-severity={task.severity} onMouseEnter={() => setHoveredTaskId(task.id)} onMouseLeave={() => setHoveredTaskId(null)}>
                    <button
                      type="button"
                      className="instance-ping-task"
                      data-visible={visible ? "true" : "false"}
                      aria-pressed={visible}
                      onClick={() => toggleTask(task.id)}
                      onFocus={() => setHoveredTaskId(task.id)}
                      onBlur={() => setHoveredTaskId(null)}
                      style={{ borderColor: visible ? task.color : "var(--border-subtle)" }}
                      title={[taskName, `当前 ${formatLatency(task.latest)} | 均值 ${formatLatency(task.avg)} | 丢包 ${task.loss == null ? "无样本" : formatPacketLoss(task.loss)}`, `p99 ${formatLatency(task.p99)} | 抖动 ${formatMetricNumber(task.volatility)}`, `min ${formatLatency(task.min)} | max ${formatLatency(task.max)} | 样本 ${task.total ?? 0} | 间隔 ${task.interval}s`].join("\n")}
                    >
                      <span className="instance-ping-task-dot" style={{ background: task.color }} aria-hidden />
                      <span className="instance-ping-task-name">{taskName}</span>
                      <span className={`instance-ping-severity is-${task.severity}`}>{task.severity === "critical" ? "严重" : task.severity === "warning" ? "波动" : "正常"}</span>
                      <span className="instance-ping-task-primary" style={{ color: task.latest != null ? latencyHeatColor(task.latest) : "var(--text-tertiary)" }}>{metricMode === "rtt" ? formatLatency(task.latest) : task.loss == null ? "—" : formatPacketLoss(task.loss)}</span>
                      <span className="instance-ping-task-loss">{metricMode === "rtt" ? task.loss == null ? "无样本" : formatPacketLoss(task.loss) : formatLatency(task.avg)}</span>
                    </button>
                    <button type="button" className="instance-ping-watch" data-active={watched ? "true" : "false"} aria-pressed={watched} aria-label={`${watched ? "取消关注" : "关注"} ${taskName}`} title={watched ? "取消关注线路" : "关注线路"} onClick={() => toggleWatched(task.id)}><Star size={14} fill={watched ? "currentColor" : "none"} /></button>
                      <button type="button" className="instance-ping-locate" aria-label={`快速定位 ${taskName}`} title="快速定位并高亮线路" onClick={() => { setHoveredTaskId(task.id); document.getElementById(`ping-chart-plot-${uuid}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }}><MapPin size={13} /></button>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {candidateTasks.length === 0 && <div className="instance-empty">{viewFilter === "watched" ? "还没有关注线路，可点选星标加入关注。" : viewFilter === "anomalies" ? "当前没有异常线路。" : "暂无可显示的线路。"}</div>}
      </div>

      <div
        ref={chartSizeRef}
        id={`ping-chart-plot-${uuid}`}
        className="instance-uplot-wrap is-large"
        data-query-hours={queryHours}
        data-window-start={chartWindow?.[0]}
        data-window-end={chartWindow?.[1]}
        data-retention-limited={retentionLimited ? "true" : "false"}
      >
        {metricChart && options && visibleTasks.length > 0 ? (
          <>
            <UplotReact
              // 图表视图切换时重建图表，避免 uPlot 保留旧的 range 或线条显隐状态。
              key={`${uuid}-${hours}-${metricMode}-${smoothLines ? "smooth" : "raw"}-${cutPeak ? "cut" : "full"}-${connectNulls ? "span" : "gap"}-${dataUpdatedAt}`}
              options={options}
              data={metricChart}
              resetScales={false}
            />
            {tooltip.show && (
              <div
                className="instance-chart-tooltip"
                style={{ left: tooltip.left, top: tooltip.top }}
              >
                <div className="instance-chart-tooltip-time">{tooltip.time}</div>
                {tooltip.rows.map((row) => (
                  <div key={`${row.label}-${row.color}`} className="instance-chart-tooltip-row">
                    <span className="instance-chart-tooltip-dot" style={{ background: row.color }} />
                    <span>{row.label}</span>
                    <strong>{row.value}</strong>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="instance-empty">当前已隐藏全部线路，点击上方按钮可恢复显示</div>
        )}
      </div>
    </InstancePanel>
  );
}
