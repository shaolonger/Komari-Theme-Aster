import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import UplotReact from "uplot-react";
import type uPlot from "uplot";
import { RefreshCw } from "lucide-react";
import { getComparisonLoadRecords, getComparisonRecordsMaxCount } from "@/services/api";
import { formatBytes } from "@/utils/format";
import { getTrafficRangeUsage, type TrafficRangePoint } from "@/utils/trafficRange";
import type { PingTimeRange } from "@/utils/pingTimeRange";
import { usePreferences } from "@/hooks/usePreferences";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { InstanceChartLoading, InstancePanel } from "./InstancePanel";
import {
  buildChartTooltipHooks,
  CHART_PALETTE,
  createTimeAxisFormatter,
  formatChartCoverageTime,
  getAxisColors,
  useResponsiveChartSize,
  type ChartTooltipState,
} from "./chartShared";

const COUNTER_BOUNDARY_MS = 15 * 60_000;
const POINTS_PER_HOUR = 60;
const TRAFFIC_COLORS = [CHART_PALETTE.success, CHART_PALETTE.cpu];
const EMPTY_TRAFFIC_POINTS: TrafficRangePoint[] = [];

interface TrafficQueryResult {
  records: Awaited<ReturnType<typeof getComparisonLoadRecords>>[string];
  start: number;
  end: number;
}

function formatRangeLabel(hours: number, custom: boolean) {
  if (custom) return "自定义范围";
  if (hours % 24 === 0) return `${hours / 24} 天`;
  return `${hours} 小时`;
}

function formatTooltipBytes(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : formatBytes(value);
}

export function TrafficChart({
  uuid,
  hours,
  range,
  active = true,
}: {
  uuid: string;
  hours: number;
  range?: PingTimeRange;
  active?: boolean;
}) {
  const { resolvedAppearance } = usePreferences();
  const themeSettings = useThemeSettings();
  const displayTimeZone = themeSettings.displayTimeZone;
  const { w, h, ref: chartSizeRef } = useResponsiveChartSize("wide");
  const [tooltip, setTooltip] = useState<ChartTooltipState>({
    show: false,
    left: 0,
    top: 0,
    rows: [],
    time: "",
  });

  const query = useQuery<TrafficQueryResult>({
    queryKey: ["records", "traffic-range", uuid, hours, range?.start, range?.end],
    queryFn: async () => {
      const now = Date.now();
      const end = range ? Date.parse(range.end) : now;
      const start = range ? Date.parse(range.start) : end - hours * 3_600_000;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        throw new Error("所选时间范围无效");
      }
      const queryStart = start - COUNTER_BOUNDARY_MS;
      const queryHours = Math.max((end - queryStart) / 3_600_000, 1 / 60);
      const recordsByUuid = await getComparisonLoadRecords({
        uuids: [uuid],
        hours: queryHours,
        loadType: "traffic",
        range: {
          start: new Date(queryStart).toISOString(),
          end: new Date(end).toISOString(),
        },
        maxPoints: getComparisonRecordsMaxCount(queryHours, POINTS_PER_HOUR),
      });
      return { records: recordsByUuid[uuid] ?? [], start, end };
    },
    enabled: Boolean(uuid) && active,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const usage = useMemo(
    () => query.data
      ? getTrafficRangeUsage(query.data.records, query.data.start, query.data.end)
      : null,
    [query.data],
  );
  const points = usage?.points ?? EMPTY_TRAFFIC_POINTS;
  const rangeStart = query.data?.start;
  const rangeEnd = query.data?.end;
  const rangeHours = rangeStart != null && rangeEnd != null
    ? (rangeEnd - rangeStart) / 3_600_000
    : hours;
  const xRange = useMemo<[number, number] | undefined>(() =>
    rangeStart != null && rangeEnd != null
      ? [rangeStart / 1_000, rangeEnd / 1_000]
      : undefined,
  [rangeEnd, rangeStart]);
  const data = useMemo<uPlot.AlignedData>(() => [
    points.map((point) => point.time),
    points.map((point) => point.up),
    points.map((point) => point.down),
  ], [points]);
  const chartOptions = useMemo<uPlot.Options>(() => {
    const isDark = resolvedAppearance === "dark";
    const { grid, text } = getAxisColors(isDark);
    const tooltipHooks = buildChartTooltipHooks({
      rangeHours,
      displayTimeZone,
      estimatedWidth: 180,
      setTooltip,
      buildRows: (index, chartData) => [
        { label: "上行", value: formatTooltipBytes(chartData[1]?.[index] as number | null), color: TRAFFIC_COLORS[0] },
        { label: "下行", value: formatTooltipBytes(chartData[2]?.[index] as number | null), color: TRAFFIC_COLORS[1] },
      ],
    });

    return {
      width: w,
      height: h,
      padding: [8, 12, 10, 2],
      cursor: { drag: { x: true, y: false } },
      legend: { show: false },
      scales: {
        x: { time: true, ...(xRange ? { auto: false, range: xRange } : {}) },
        y: { auto: true },
      },
      axes: [
        {
          stroke: text,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          size: rangeHours >= 72 ? 38 : 34,
          values: createTimeAxisFormatter(rangeHours, displayTimeZone),
        },
        {
          stroke: text,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          size: 68,
          values: (_chart, splits) => splits.map((value) => value <= 0 ? "" : formatBytes(value)),
        },
      ],
      series: [
        { label: "time" },
        ...["上行", "下行"].map((label, index) => ({
          label,
          stroke: TRAFFIC_COLORS[index],
          width: 1.8,
          points: { show: false },
        })),
      ],
      hooks: {
        init: [
          (chart) => chart.root.setAttribute("aria-label", "所选时间范围内的上行和下行流量"),
          tooltipHooks.onInit,
        ],
        setCursor: [tooltipHooks.onSetCursor],
      },
    };
  }, [displayTimeZone, h, rangeHours, resolvedAppearance, setTooltip, w, xRange]);

  if (query.isLoading) return <InstanceChartLoading title="流量图表" />;

  const coverageSummary = usage?.coverageStart != null && usage.coverageEnd != null
    ? `${formatChartCoverageTime(usage.coverageStart / 1_000, displayTimeZone)} - ${formatChartCoverageTime(usage.coverageEnd / 1_000, displayTimeZone)}`
    : "—";
  const qualityLabel = usage?.quality === "measured"
    ? "边界采样完整"
    : usage?.quality === "partial"
      ? "部分覆盖"
      : "暂无可用采样";

  return (
    <InstancePanel
      title="流量图表"
      description="根据 VPS 的累计上/下行计数器计算所选区间用量；计数器重置或区间起点缺少邻近采样时会标记为部分覆盖。"
      aside={(
        <div className="instance-chart-headmeta">
          <span className="instance-chart-range-chip">{formatRangeLabel(hours, Boolean(range))}</span>
          <button
            type="button"
            className="instance-toggle-button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw size={14} />
            刷新
          </button>
        </div>
      )}
      className="instance-chart-panel instance-traffic-panel"
    >
      {query.error ? (
        <div className="instance-empty" role="alert">
          流量历史读取失败：{query.error instanceof Error ? query.error.message : "未知错误"}
        </div>
      ) : usage?.quality === "unavailable" ? (
        <div className="instance-empty">所选范围暂无可用的流量历史数据</div>
      ) : usage ? (
        <>
          <div className="instance-traffic-summary">
            <div className="instance-traffic-stat" data-tone="up">
              <span>上行用量</span>
              <strong>{formatBytes(usage.up)}</strong>
            </div>
            <div className="instance-traffic-stat" data-tone="down">
              <span>下行用量</span>
              <strong>{formatBytes(usage.down)}</strong>
            </div>
            <div className="instance-traffic-stat" data-tone="total">
              <span>合计用量</span>
              <strong>{formatBytes(usage.total)}</strong>
            </div>
          </div>
          <div className="instance-traffic-coverage">
            <span data-quality={usage.quality}>{qualityLabel}</span>
            <span>采样覆盖 {coverageSummary}</span>
            <span>{usage.sampleCount} 个采样点 · {formatRangeLabel(hours, Boolean(range))}</span>
          </div>
          {points.length > 1 ? (
            <div className="instance-traffic-chart-wrap" ref={chartSizeRef}>
              <UplotReact
                key={`${uuid}-${hours}-${range?.start ?? "rolling"}-${range?.end ?? ""}`}
                options={chartOptions}
                data={data}
                resetScales={false}
              />
              {tooltip.show && (
                <div className="instance-chart-tooltip" style={{ left: tooltip.left, top: tooltip.top }}>
                  <div className="instance-chart-tooltip-time">{tooltip.time}</div>
                  {tooltip.rows.map((row) => (
                    <div key={row.label} className="instance-chart-tooltip-row">
                      <span className="instance-chart-tooltip-dot" style={{ background: row.color }} />
                      <span>{row.label}</span>
                      <strong>{row.value}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="instance-empty instance-traffic-chart-empty">
              历史采样点不足，暂时无法绘制趋势线；当前用量仅覆盖已取得的采样。
            </div>
          )}
        </>
      ) : null}
    </InstancePanel>
  );
}
