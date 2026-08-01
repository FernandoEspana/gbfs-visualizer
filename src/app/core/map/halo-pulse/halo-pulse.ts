/** One full pulse, in milliseconds. The mockup's 1.6s, kept. */
export const HALO_PERIOD_MS = 1_600;

/**
 * The pulse starts just outside the selected disc and ends wide enough to read
 * as a halo. The mockup's `scale(0.6) → scale(2.6)` of a 44px circle is not
 * carried over literally: 114px of glow over a real basemap swallows the
 * neighbouring vehicles.
 */
const MIN_RADIUS_PX = 12;
const MAX_RADIUS_PX = 34;
const MAX_OPACITY = 0.55;

/**
 * Where the resting halo sits in the pulse. Not the midpoint: an ease-out curve
 * spends most of its opacity in the first half, so 0.5 renders at 0.07 alpha —
 * technically a halo, visually nothing.
 */
const RESTING_PROGRESS = 0.25;

export interface HaloFrame {
  radius: number; // px
  opacity: number; // 0..1
}

/**
 * Where the pulse is, `elapsedMs` after it started. Pure and periodic, so the
 * arithmetic can be tested without a map, a canvas or a clock.
 */
export function haloFrame(elapsedMs: number): HaloFrame {
  return frameAt(progress(elapsedMs));
}

/** What the halo looks like when motion is not allowed. */
export const HALO_RESTING_FRAME: HaloFrame = frameAt(RESTING_PROGRESS);

/** A time before the pulse began is the pulse's first instant, never a wrap. */
function progress(elapsedMs: number): number {
  if (elapsedMs <= 0) {
    return 0;
  }

  return (elapsedMs % HALO_PERIOD_MS) / HALO_PERIOD_MS;
}

/** Ease-out cubic: quick out of the marker, then a slow fade. */
function frameAt(t: number): HaloFrame {
  const eased = 1 - (1 - t) ** 3;

  return {
    radius: MIN_RADIUS_PX + (MAX_RADIUS_PX - MIN_RADIUS_PX) * eased,
    opacity: MAX_OPACITY * (1 - eased),
  };
}
