import type { LoadRecord } from "@/types/komari";
import { getZonedDateTimeParts, type DisplayTimeZone } from "@/utils/timeDisplay";

export interface DailyTrafficPoint {
  date: string;
  bytes: number | null;
  partial: boolean;
}

function dateKey(time: number, zone: DisplayTimeZone) {
  const { year, month, day } = getZonedDateTimeParts(time, zone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Observed counter differences and a tentative reset, never a confirmed billing boundary. */
export function buildDailyTrafficTrend(records: LoadRecord[] | undefined, now: number, zone: DisplayTimeZone): { days: DailyTrafficPoint[]; resetObservedAt: number | null } {
  const parts = getZonedDateTimeParts(now, zone);
  const calendar = Date.UTC(parts.year, parts.month - 1, parts.day);
  const samples = (records ?? []).map((record) => {
    const time = typeof record.time === "number" ? (record.time > 1e12 ? record.time : record.time * 1000) : Date.parse(record.time);
    return { time, up: record.net_total_up, down: record.net_total_down };
  }).filter((sample) => Number.isFinite(sample.time) && sample.time <= now && Number.isFinite(sample.up) && sample.up >= 0 && Number.isFinite(sample.down) && sample.down >= 0)
    .sort((a, b) => a.time - b.time);
  let resetObservedAt: number | null = null;
  for (let i = 1; i < samples.length; i++) {
    const before = samples[i - 1], after = samples[i];
    const elapsed = after.time - before.time;
    // Monthly Agent rotation usually drops both cumulative counters. Other
    // events can look identical, so this is only a candidate boundary.
    if (elapsed > 0 && elapsed <= 6 * 3_600_000 && after.up <= before.up && after.down <= before.down &&
      (before.up + before.down > 0) && after.up + after.down < (before.up + before.down) * 0.5) {
      resetObservedAt = after.time;
    }
  }
  const resetDate = resetObservedAt == null ? null : dateKey(resetObservedAt, zone);
  const days = Array.from({ length: 32 }, (_, index) => ({
    date: new Date(calendar - (31 - index) * 86_400_000).toISOString().slice(0, 10),
    bytes: null as number | null,
    partial: false,
  })).filter((day) => resetDate == null || day.date >= resetDate);
  const byDate = new Map(days.map((day) => [day.date, day]));
  let previous: typeof samples[number] | undefined;
  let previousDate = "";
  for (const sample of samples) {
    if (resetObservedAt != null && sample.time < resetObservedAt) continue;
    const currentDate = dateKey(sample.time, zone);
    const day = byDate.get(currentDate);
    if (day && (!previous || currentDate !== previousDate)) day.partial = true;
    if (day && previous && sample.time > previous.time) {
      // Never assign an unobserved interval or reset to a calendar day.
      const valid = currentDate === previousDate && sample.time - previous.time <= 6 * 3_600_000 && sample.up >= previous.up && sample.down >= previous.down;
      if (valid) day.bytes = (day.bytes ?? 0) + sample.up - previous.up + sample.down - previous.down;
      else day.partial = true;
    }
    previous = sample;
    previousDate = currentDate;
  }
  return { days, resetObservedAt };
}
