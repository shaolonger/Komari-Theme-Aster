import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAllNodeMeta } from "@/hooks/useNode";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { getComparisonLoadRecords } from "@/services/api";
import { formatByteRateLabel } from "@/utils/format";
import { formatDisplayDateTime } from "@/utils/timeDisplay";
import type { HomeNodeSummary } from "@/services/wsStore";
export function FleetThroughput({
  summaries,
}: {
  summaries: HomeNodeSummary[];
}) {
  const all = useAllNodeMeta();
  const { displayTimeZone } = useThemeSettings();
  const uuids = useMemo(() => summaries.map((n) => n.uuid), [summaries]);
  const query = useQuery({
    queryKey: ["glacier-fleet-throughput", uuids],
    queryFn: () =>
      getComparisonLoadRecords({
        uuids,
        nodes: all,
        loadType: "network",
        hours: 24,
        maxPoints: Math.max(
          12,
          Math.min(96, Math.floor(20_000 / Math.max(1, uuids.length))),
        ),
      }),
    staleTime: 60_000,
    refetchInterval: 60_000,
    enabled: uuids.length > 0,
    retry: 1,
  });
  const points = useMemo(() => {
    const buckets = new Map<number, { sum: number; nodes: Set<string> }>();
    for (const [uuid, rows] of Object.entries(query.data ?? {})) {
      const samples = new Map<number, number>();
      for (const r of rows) {
        const t =
          Math.floor(
            (typeof r.time === "number"
              ? r.time > 1e12
                ? r.time
                : r.time * 1000
              : Date.parse(r.time)) / 900_000,
          ) * 900_000;
        if (
          Number.isFinite(t) &&
          Number.isFinite(r.net_in) &&
          Number.isFinite(r.net_out)
        )
          samples.set(t, (r.net_in ?? 0) + (r.net_out ?? 0));
      }
      for (const [t, value] of samples) {
        const b = buckets.get(t) ?? { sum: 0, nodes: new Set<string>() };
        b.sum += value;
        b.nodes.add(uuid);
        buckets.set(t, b);
      }
    }
    return [...buckets].sort(([a], [b]) => a - b);
  }, [query.data]);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...points.map(([, v]) => v.sum));
  const first = points[0]?.[0] ?? 0,
    last = points.at(-1)?.[0] ?? first;
  const x = (t: number) => ((t - first) / Math.max(1, last - first)) * 800;
  // Break at missing 15-minute buckets instead of drawing invented history.
  const path = points
    .map(
      ([t, v], i) =>
        `${i === 0 || t - points[i - 1][0] > 1_800_000 ? "M" : "L"}${x(t)},${112 - (v.sum / max) * 93}`,
    )
    .join(" ");
  const time = (t: number) =>
    formatDisplayDateTime(t, displayTimeZone, {
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <div className="glacier-fleet-chart" aria-label="最近 24 小时全网吞吐趋势">
      <svg
        viewBox="0 0 800 125"
        preserveAspectRatio="none"
        role="img"
        aria-label={
          points.length
            ? `全网吞吐，${points.length} 个时间段`
            : "暂无全网吞吐历史"
        }
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(
            Math.min(
              points.length - 1,
              Math.max(
                0,
                Math.round(
                  ((e.clientX - r.left) / r.width) * (points.length - 1),
                ),
              ),
            ),
          );
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient
            id="glacier-throughput-fill"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop stopColor="#40b9ff" stopOpacity=".45" />
            <stop offset="1" stopColor="#3196ff" stopOpacity=".04" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <line
            key={i}
            x1={i * 133.3}
            x2={i * 133.3}
            y1="4"
            y2="113"
            stroke="#dce6f5"
            strokeDasharray="2 3"
          />
        ))}
        {[20, 65, 112].map((y) => (
          <line key={y} x1="0" x2="800" y1={y} y2={y} stroke="#e6edf8" />
        ))}
        {points.length > 1 && (
          <>
            <path
              d={path
                .split("M")
                .filter(Boolean)
                .map((segment) => {
                  const start = segment.split(",")[0];
                  const end = segment.trim().split("L").at(-1)!.split(",")[0];
                  return `M${segment} L${end},113 L${start},113 Z`;
                })
                .join(" ")}
              fill="url(#glacier-throughput-fill)"
            />
            <path
              d={path}
              fill="none"
              stroke="#138cff"
              strokeWidth="1.7"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
        {hover != null && points[hover] && (
          <circle
            cx={x(points[hover][0])}
            cy={112 - (points[hover][1].sum / max) * 93}
            r="4"
            fill="#00be8d"
            stroke="white"
            strokeWidth="2"
          />
        )}
      </svg>
      {points.length < 2 && (
        <span className="glacier-chart-empty">
          {query.isLoading
            ? "正在加载吞吐历史…"
            : query.isError
              ? "吞吐历史读取失败"
              : "暂无吞吐历史"}
        </span>
      )}
      {hover != null && points[hover] && (
        <div className="glacier-fleet-tooltip">
          {time(points[hover][0])} · {formatByteRateLabel(points[hover][1].sum)}{" "}
          · {points[hover][1].nodes.size}/{uuids.length} 台
        </div>
      )}
      <div className="glacier-chart-axis">
        <span>{first ? time(first) : "—"}</span>
        <span>最近 24 小时 · 按可用节点汇总</span>
        <span>{last ? time(last) : "—"}</span>
      </div>
    </div>
  );
}
