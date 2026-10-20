import {
  formatDateTimeLocalValue,
  parseDateTimeLocalInZone,
} from "@/utils/timeDisplay";

/** Reject calendar overflow and local times skipped by DST instead of shifting. */
export function parseReportDate(value: string, zone: string) {
  const parsed = parseDateTimeLocalInZone(value, zone);
  if (
    parsed == null ||
    formatDateTimeLocalValue(parsed, zone) !== value.slice(0, 16)
  )
    return null;
  return parsed;
}
