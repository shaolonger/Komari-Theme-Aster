import { useContext, useMemo } from "react";
import { DailyTrafficContext } from "./DailyTrafficContext";
import { buildDailyTrafficTrend } from "@/utils/dailyTrafficTrend";
import { formatBytes } from "@/utils/format";

export default function DailyTrafficTrend({ uuid }: { uuid: string }) {
  const { records, now, timeZone } = useContext(DailyTrafficContext);
  const trend = useMemo(() => now ? buildDailyTrafficTrend(records?.[uuid], now, timeZone) : { days: [], resetObservedAt: null }, [records, uuid, now, timeZone]);
  const points = trend.days;
  const max = Math.max(0, ...points.map((point) => point.bytes ?? 0));
  const available = points.some((point) => point.bytes != null);
  const explanation = `${trend.resetObservedAt == null ? "最近 32 天，未观察到可识别的重置；周期未知" : "从最近一次疑似计数器重置开始；其他原因也可能导致回退，周期未确认"}。每日观测上行 + 下行；跨日、采样中断和计数器回退区间未计入，可能低估。日期按主题时区显示，可能与 VPS 本地重置日期不同。`;
  return <div className="daily-traffic-trend" role="img" aria-label={available ? explanation : "每日流量暂无可计算的历史数据；计费周期未提供。"} title={available ? explanation : "每日流量暂无可计算的历史数据"}>
    <span>{trend.resetObservedAt == null ? "近32天" : "疑似周期"}</span>
    {available ? <div className="daily-traffic-bars" aria-hidden>{points.map((point) => <i key={point.date} data-missing={point.bytes == null || undefined} data-partial={point.partial || undefined} style={{ height: point.bytes == null ? "2px" : `${Math.max(2, max > 0 ? point.bytes / max * 100 : 2)}%` }} title={`${point.date} · ${point.bytes == null ? "暂无数据" : `${formatBytes(point.bytes)}${point.partial ? "（部分）" : ""}`}`} />)}</div> : <small>暂无数据</small>}
  </div>;
}
