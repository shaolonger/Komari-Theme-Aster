import { useContext, useId, useMemo } from "react";
import { DailyTrafficContext } from "./DailyTrafficContext";
import { buildDailyTrafficTrend } from "@/utils/dailyTrafficTrend";
import { dailyTrafficGeometry } from "@/utils/dailyTrafficGeometry";

export default function DailyTrafficTrend({ uuid }: { uuid: string }) {
  const gradientId = `traffic-${useId().replace(/[^a-z0-9_-]/gi, "")}`;
  const { records, now, timeZone } = useContext(DailyTrafficContext);
  const trend = useMemo(() => now ? buildDailyTrafficTrend(records?.[uuid], now, timeZone) : { days: [], resetObservedAt: null }, [records, uuid, now, timeZone]);
  const geometry = useMemo(() => dailyTrafficGeometry(trend.days), [trend.days]);
  const explanation = `${trend.resetObservedAt == null ? "最近 32 天，未观察到可识别的重置；周期未知" : "从最近一次疑似计数器重置开始；其他原因也可能导致回退，周期未确认"}。每日观测上行 + 下行；跨日、采样中断和计数器回退区间未计入，可能低估。日期按主题时区显示，可能与 VPS 本地重置日期不同。`;
  return <svg className="daily-traffic-trend" data-available={geometry.length > 0 ? "true" : "false"} viewBox="0 0 100 24" preserveAspectRatio="none" role="img" aria-label={geometry.length ? explanation : "每日流量暂无可计算的历史数据"}>
    <title>{geometry.length ? explanation : "每日流量暂无可计算的历史数据"}</title>
    <defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".38" /><stop offset="1" stopColor="currentColor" stopOpacity=".08" /></linearGradient></defs>
    {geometry.map((segment, index) => segment.point ? <circle key={index} className="daily-traffic-dot" cx={segment.point.x} cy={segment.point.y} r="1.4" /> : <g key={index}><path fill={`url(#${gradientId})`} d={segment.area} /><path className="daily-traffic-line" d={segment.line} /></g>)}
  </svg>;
}
