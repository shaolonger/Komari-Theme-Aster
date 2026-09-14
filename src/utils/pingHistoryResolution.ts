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

/**
 * Preset ranges always end "now". When Komari advertises a shorter Ping
 * retention window, asking the server to aggregate the unavailable outer
 * range destroys the detail that still exists (a 30-day query over one day of
 * retained data can collapse to only two daily points). Query the retained
 * slice at its native density instead. The chart can then show that available
 * slice honestly instead of stretching two coarse daily points across its
 * entire width.
 *
 * Explicit/custom ranges cannot be shortened safely because doing so would
 * change which historical instant the user requested.
 */
export function getPingHistoryQueryHours(
  requestedHours: number,
  retentionHours: number | null | undefined,
  hasExplicitRange = false,
) {
  const safeRequested = Number.isFinite(requestedHours) && requestedHours > 0
    ? requestedHours
    : 1;
  if (
    hasExplicitRange ||
    !Number.isFinite(retentionHours) ||
    retentionHours == null ||
    retentionHours <= 0
  ) {
    return safeRequested;
  }

  return Math.min(safeRequested, retentionHours);
}

export function getPingHistoryWindow({
  requestedHours,
  explicitStart,
  explicitEnd,
  responseEnd,
  latestSample,
}: {
  requestedHours: number;
  explicitStart?: number | null;
  explicitEnd?: number | null;
  responseEnd?: number | null;
  latestSample?: number | null;
}): [number, number] | null {
  if (
    explicitStart != null &&
    explicitEnd != null &&
    Number.isFinite(explicitStart) &&
    Number.isFinite(explicitEnd) &&
    explicitEnd > explicitStart
  ) {
    return [explicitStart, explicitEnd];
  }

  const end = Number.isFinite(responseEnd)
    ? responseEnd
    : Number.isFinite(latestSample)
      ? latestSample
      : null;
  if (end == null) return null;
  const safeHours = Number.isFinite(requestedHours) && requestedHours > 0
    ? requestedHours
    : 1;
  return [end - safeHours * 60 * 60, end];
}
