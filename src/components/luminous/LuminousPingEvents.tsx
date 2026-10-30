import { useMemo } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import {
  formatDisplayDateTime,
  type DisplayTimeZone,
} from "@/utils/timeDisplay";
import { getPingLossPercent, isValidPingLatency } from "@/utils/pingSamples";
import { formatLatency, formatPacketLoss } from "@/utils/format";
import { toChartSeconds } from "@/components/instance/chartShared";
import type { PingRecord } from "@/types/komari";
export default function LuminousPingEvents({
  intervals,
  records,
  timeZone,
}: {
  intervals: [number, number][];
  records: PingRecord[];
  timeZone: DisplayTimeZone;
}) {
  const events = useMemo(
    () =>
      [...intervals]
        .sort((a, b) => b[1] - b[0] - (a[1] - a[0]))
        .slice(0, 3)
        .sort((a, b) => a[0] - b[0])
        .map(([start, end]) => {
          const samples = records.filter((record) => {
            const time = toChartSeconds(record.time);
            return time >= start && time <= end;
          });
          const loss = getPingLossPercent(samples);
          let peak: number | null = null;
          for (const record of samples)
            if (isValidPingLatency(record.value))
              peak = Math.max(peak ?? 0, record.value);
          return { start, end, loss, peak };
        }),
    [intervals, records],
  );
  const time = (value: number) =>
    formatDisplayDateTime(value * 1000, timeZone, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  return (
    <section className="orbital-event-timeline luminous-event-cards luminous-glass">
      <header>
        <AlertTriangle size={22} />
        <h3>异常摘要</h3>
        <span>检测到的主要网络异常观测时段</span>
      </header>
      <div className="luminous-events-grid">
        {events.map((event) => (
          <article
            key={event.start}
            data-tone={(event.loss ?? 0) >= 20 ? "critical" : "warning"}
          >
            <i />
            <strong>{time(event.start)}</strong>
            <b>{(event.loss ?? 0) >= 5 ? "线路出现丢包" : "线路延迟升高"}</b>
            <p>
              {event.loss == null
                ? "暂无丢包统计"
                : "区间丢包 " + formatPacketLoss(event.loss)}
              {event.peak == null
                ? ""
                : "，RTT 峰值 " + formatLatency(event.peak)}
              <br />
              {time(event.start)} – {time(event.end)}
            </p>
            <span>{(event.loss ?? 0) >= 20 ? "高丢包" : "网络波动"}</span>
          </article>
        ))}
        {!events.length && (
          <p className="luminous-events-empty">所选时间范围未检测到异常时段</p>
        )}
      </div>
      <details className="luminous-all-events">
        <summary>
          全部异常观测时段 ({intervals.length}) <ChevronDown size={11} />
        </summary>
        <ol>
          {intervals.map(([start, end]) => (
            <li key={start}>
              {time(start)} – {time(end)}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
