const SHORT_RANGE_POINT_LIMIT = 160;
const LONG_RANGE_BUCKET_SECONDS = 5 * 60;
const LONG_RANGE_POINT_LIMIT = 4_320;

/**
 * Select a useful Ping history density without trying to paint every raw probe
 * on a finite-width chart. Seven days retains one aggregate per five minutes;
 * longer windows keep that precision until the 4,320-point ceiling, which is
 * a ten-minute view at thirty days.
 */
export function getPingHistoryPointLimit(hours: number) {
  const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 1;
  if (safeHours <= 24) return SHORT_RANGE_POINT_LIMIT;

  return Math.min(
    LONG_RANGE_POINT_LIMIT,
    Math.max(
      SHORT_RANGE_POINT_LIMIT,
      Math.ceil((safeHours * 60 * 60) / LONG_RANGE_BUCKET_SECONDS),
    ),
  );
}
