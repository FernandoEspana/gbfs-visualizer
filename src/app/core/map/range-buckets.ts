export interface RangeBucket {
  /** Lower bound, inclusive, in metres. The first bucket starts at 0. */
  fromMeters: number;
  color: string;
  label: string;
}

/** Cut points chosen against the live feed: median ~19 km, max ~39 km. */
export const RANGE_BUCKETS: readonly RangeBucket[] = [
  { fromMeters: 0, color: '#d7191c', label: 'Under 5 km' },
  { fromMeters: 5_000, color: '#fdae61', label: '5–15 km' },
  { fromMeters: 15_000, color: '#2c7bb6', label: '15–25 km' },
  { fromMeters: 25_000, color: '#1a9850', label: 'Over 25 km' },
];

/** Vehicles whose `currentRangeMeters` is absent. Never a bucket colour. */
export const UNKNOWN_RANGE_COLOR = '#9ca3af';

/**
 * The selection halo. Not a data colour: it has to read against every bucket
 * and against the basemap, so it is the darkest thing on the map.
 */
export const SELECTION_COLOR = '#111827';
