export const SYSTEM_DISPLAY_TIME_ZONE = "system";

export const DISPLAY_TIME_ZONE_PRESETS = [
  SYSTEM_DISPLAY_TIME_ZONE,
  "UTC",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
] as const;

export type DisplayTimeZone = typeof SYSTEM_DISPLAY_TIME_ZONE | (string & {});

export interface ZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const zonedPartsFormatters = new Map<string, Intl.DateTimeFormat>();
const displayFormatters = new Map<string, Intl.DateTimeFormat>();

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}

function dateTimePartsKey(parts: ZonedDateTimeParts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function getSystemDateTimeParts(timestampMs: number): ZonedDateTimeParts {
  const date = new Date(timestampMs);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  };
}

function getZonedPartsFormatter(timeZone: string) {
  const cached = zonedPartsFormatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  zonedPartsFormatters.set(timeZone, formatter);
  return formatter;
}

export function getBrowserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function isValidIanaTimeZone(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timeZone = value.trim();
  if (!timeZone || timeZone === SYSTEM_DISPLAY_TIME_ZONE) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function normalizeDisplayTimeZone(value: unknown): DisplayTimeZone {
  if (typeof value !== "string") return SYSTEM_DISPLAY_TIME_ZONE;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === SYSTEM_DISPLAY_TIME_ZONE) {
    return SYSTEM_DISPLAY_TIME_ZONE;
  }
  if (!isValidIanaTimeZone(trimmed)) return SYSTEM_DISPLAY_TIME_ZONE;
  return new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).resolvedOptions().timeZone;
}

export function resolveIntlTimeZone(displayTimeZone: DisplayTimeZone | null | undefined) {
  const normalized = normalizeDisplayTimeZone(displayTimeZone);
  return normalized === SYSTEM_DISPLAY_TIME_ZONE ? undefined : normalized;
}

export function describeDisplayTimeZone(displayTimeZone: DisplayTimeZone | null | undefined) {
  const normalized = normalizeDisplayTimeZone(displayTimeZone);
  return normalized === SYSTEM_DISPLAY_TIME_ZONE ? `跟随浏览器 (${getBrowserTimeZone()})` : normalized;
}

export function getZonedDateTimeParts(
  timestampMs: number,
  displayTimeZone: DisplayTimeZone | null | undefined,
): ZonedDateTimeParts {
  const normalized = normalizeDisplayTimeZone(displayTimeZone);
  if (normalized === SYSTEM_DISPLAY_TIME_ZONE) {
    return getSystemDateTimeParts(timestampMs);
  }

  const formatter = getZonedPartsFormatter(normalized);
  const parts = formatter.formatToParts(new Date(timestampMs));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.get("year") ?? 0),
    month: Number(values.get("month") ?? 0),
    day: Number(values.get("day") ?? 0),
    hour: Number(values.get("hour") ?? 0),
    minute: Number(values.get("minute") ?? 0),
    second: Number(values.get("second") ?? 0),
  };
}

export function formatDisplayDateTime(
  timestampMs: number,
  displayTimeZone: DisplayTimeZone | null | undefined,
  options: Intl.DateTimeFormatOptions = {},
) {
  if (!timestampMs || !Number.isFinite(timestampMs)) return "—";
  const normalized = normalizeDisplayTimeZone(displayTimeZone);
  const key = JSON.stringify([normalized, options]);
  const cached = displayFormatters.get(key);
  const formatter =
    cached ??
    new Intl.DateTimeFormat("zh-CN", {
      timeZone: resolveIntlTimeZone(normalized),
      ...options,
    });
  if (!cached) displayFormatters.set(key, formatter);
  return formatter.format(new Date(timestampMs));
}

export function formatClockTime(
  timestampMs: number,
  displayTimeZone: DisplayTimeZone | null | undefined,
  includeSeconds = false,
) {
  const parts = getZonedDateTimeParts(timestampMs, displayTimeZone);
  const base = `${pad2(parts.hour)}:${pad2(parts.minute)}`;
  return includeSeconds ? `${base}:${pad2(parts.second)}` : base;
}

export function formatDateTimeLocalValue(
  timestampSeconds: number | null | undefined,
  displayTimeZone: DisplayTimeZone | null | undefined,
) {
  if (timestampSeconds == null || !Number.isFinite(timestampSeconds)) return "";
  const parts = getZonedDateTimeParts(timestampSeconds * 1000, displayTimeZone);
  return `${parts.year.toString().padStart(4, "0")}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

export function parseDateTimeLocalInZone(
  value: string,
  displayTimeZone: DisplayTimeZone | null | undefined,
) {
  const match = value.match(
    /^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) return null;
  const target: ZonedDateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  };
  if (
    target.month < 1 ||
    target.month > 12 ||
    target.day < 1 ||
    target.day > 31 ||
    target.hour > 23 ||
    target.minute > 59 ||
    target.second > 59
  ) {
    return null;
  }

  const normalized = normalizeDisplayTimeZone(displayTimeZone);
  if (normalized === SYSTEM_DISPLAY_TIME_ZONE) {
    const localTime = new Date(
      target.year,
      target.month - 1,
      target.day,
      target.hour,
      target.minute,
      target.second,
    ).getTime();
    return Number.isFinite(localTime) ? Math.floor(localTime / 1000) : null;
  }

  let guess = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second,
  );

  for (let i = 0; i < 4; i += 1) {
    const actual = getZonedDateTimeParts(guess, normalized);
    const diffMs = dateTimePartsKey(target) - dateTimePartsKey(actual);
    if (diffMs === 0) break;
    guess += diffMs;
  }

  return Number.isFinite(guess) ? Math.floor(guess / 1000) : null;
}

export function formatAxisTime(
  timestampSeconds: number,
  rangeHours: number,
  displayTimeZone: DisplayTimeZone | null | undefined,
) {
  const parts = getZonedDateTimeParts(timestampSeconds * 1000, displayTimeZone);
  if (rangeHours >= 72) return `${pad2(parts.month)}/${pad2(parts.day)}`;
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

export function formatTooltipTime(
  timestampSeconds: number,
  rangeHours: number,
  displayTimeZone: DisplayTimeZone | null | undefined,
) {
  const parts = getZonedDateTimeParts(timestampSeconds * 1000, displayTimeZone);
  const clock = `${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;
  if (rangeHours >= 24) {
    return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)} ${clock}`;
  }
  return clock;
}

export function formatChartCoverageTime(
  timestampSeconds: number,
  displayTimeZone: DisplayTimeZone | null | undefined,
) {
  const parts = getZonedDateTimeParts(timestampSeconds * 1000, displayTimeZone);
  return `${pad2(parts.month)}/${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

export function formatExportRangeToken(
  startSeconds: number,
  endSeconds: number,
  displayTimeZone: DisplayTimeZone | null | undefined,
) {
  const start = formatDateTimeLocalValue(startSeconds, displayTimeZone).replace(/[-:T]/g, "");
  const end = formatDateTimeLocalValue(endSeconds, displayTimeZone).replace(/[-:T]/g, "");
  return `${start}-${end}`;
}
