const METERS_PER_KM = 1_000;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

/**
 * A missing range and an empty battery are different facts, so an absent value
 * is named rather than rendered as `0 km`.
 */
export function formatRange(meters: number | undefined): string {
  if (meters === undefined) {
    return 'no data';
  }

  if (meters < METERS_PER_KM) {
    return `${Math.round(meters)} m`;
  }

  return `${(meters / METERS_PER_KM).toFixed(1)} km`;
}

/**
 * Takes `nowMs` instead of reading a clock, so the caller owns the time seam.
 * A negative delta — a feed clock ahead of the browser — reads as `just now`
 * rather than as a time in the future.
 */
export function formatRelativeTime(epochMs: number, nowMs: number): string {
  const elapsed = nowMs - epochMs;

  if (elapsed < MS_PER_MINUTE) {
    return 'just now';
  }

  if (elapsed < MS_PER_HOUR) {
    return `${Math.floor(elapsed / MS_PER_MINUTE)} min ago`;
  }

  return `${Math.floor(elapsed / MS_PER_HOUR)} h ago`;
}

/** `lat, lon` at 5 decimals — about a metre, which is the feed's real precision. */
export function formatCoordinates(coordinates: {
  lat: number;
  lon: number;
}): string {
  return `${coordinates.lat.toFixed(5)}, ${coordinates.lon.toFixed(5)}`;
}
