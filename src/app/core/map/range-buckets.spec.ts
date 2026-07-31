import { bucketFor, RANGE_BUCKETS } from './range-buckets';
import { UNKNOWN_RANGE_METERS } from './vehicle-geojson';

describe('bucketFor', () => {
  it('places a range inside each bucket', () => {
    expect(bucketFor(2_000)?.label).toBe('Under 5 km');
    expect(bucketFor(9_000)?.label).toBe('5–15 km');
    expect(bucketFor(19_000)?.label).toBe('15–25 km');
    expect(bucketFor(38_000)?.label).toBe('Over 25 km');
  });

  it('treats a cut point as the lower bound of its own bucket', () => {
    for (const bucket of RANGE_BUCKETS) {
      expect(bucketFor(bucket.fromMeters)).toBe(bucket);
    }
  });

  it('keeps the metre below a cut point in the previous bucket', () => {
    expect(bucketFor(4_999)?.label).toBe('Under 5 km');
    expect(bucketFor(14_999)?.label).toBe('5–15 km');
    expect(bucketFor(24_999)?.label).toBe('15–25 km');
  });

  it('returns null for an unknown range', () => {
    expect(bucketFor(undefined)).toBeNull();
  });

  it('places a reported zero in the first bucket rather than treating it as unknown', () => {
    expect(bucketFor(0)).toBe(RANGE_BUCKETS[0]);
  });

  it('returns null for the sentinel the map paints grey', () => {
    expect(bucketFor(UNKNOWN_RANGE_METERS)).toBeNull();
  });
});
