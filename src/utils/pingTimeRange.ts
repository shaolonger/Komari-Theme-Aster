import {
  formatDateTimeLocalValue,
  getZonedDateTimeParts,
  parseDateTimeLocalInZone,
  type DisplayTimeZone,
} from "@/utils/timeDisplay";

export interface PingTimeRange { start: string; end: string }

function dateText(year: number, month: number, day: number) {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

/** Defaults to the previous local evening in the selected display time zone. */
export function previousEveningInZone(now = Date.now(), timeZone: DisplayTimeZone = "system"): PingTimeRange {
  const parts = getZonedDateTimeParts(now, timeZone);
  const today = dateText(parts.year, parts.month, parts.day);
  const previousDay = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - 1));
  const yesterday = dateText(previousDay.getUTCFullYear(), previousDay.getUTCMonth() + 1, previousDay.getUTCDate());
  return {
    start: `${yesterday}T18:00`,
    end: `${today}T00:00`,
  };
}

export function resolveRangeInZone(value: PingTimeRange, timeZone: DisplayTimeZone = "system") {
  const start = parseDateTimeLocalInZone(value.start, timeZone);
  const end = parseDateTimeLocalInZone(value.end, timeZone);
  if (start == null || end == null || end <= start) return null;
  return {
    start: new Date(start * 1_000).toISOString(),
    end: new Date(end * 1_000).toISOString(),
  };
}

export function toRangeDraft(range: { start: string; end: string }, timeZone: DisplayTimeZone = "system") {
  const start = Date.parse(range.start);
  const end = Date.parse(range.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { start: "", end: "" };
  return {
    start: formatDateTimeLocalValue(start / 1_000, timeZone),
    end: formatDateTimeLocalValue(end / 1_000, timeZone),
  };
}
