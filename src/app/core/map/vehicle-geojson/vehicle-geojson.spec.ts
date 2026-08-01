import type { Vehicle } from '@core/models/vehicle.model';
import { toFeatureCollection } from './vehicle-geojson';

function vehicle(id: string, overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id,
    coordinates: { lat: 40.7, lon: -73.8 },
    status: 'available',
    isReserved: false,
    isDisabled: false,
    currentRangeMeters: 12_000,
    ...overrides,
  };
}

describe('toFeatureCollection', () => {
  it('emits coordinates in GeoJSON order', () => {
    const collection = toFeatureCollection([
      vehicle('a', { coordinates: { lat: 40.75, lon: -73.85 } }),
    ]);

    expect(collection.features[0].geometry.coordinates).toEqual([
      -73.85, 40.75,
    ]);
  });

  it('writes the id on both the feature and its properties', () => {
    const [feature] = toFeatureCollection([vehicle('scooter-1')]).features;

    expect(feature.id).toBe('scooter-1');
    expect(feature.properties.id).toBe('scooter-1');
  });

  it('carries the reported range through', () => {
    const [feature] = toFeatureCollection([
      vehicle('a', { currentRangeMeters: 24_500 }),
    ]).features;

    expect(feature.properties.rangeMeters).toBe(24_500);
  });

  it('falls back to the sentinel when the range is missing', () => {
    const [feature] = toFeatureCollection([
      vehicle('a', { currentRangeMeters: undefined }),
    ]).features;

    expect(feature.properties.rangeMeters).toBe(-1);
  });

  it('keeps a reported range of zero rather than treating it as missing', () => {
    const [feature] = toFeatureCollection([
      vehicle('a', { currentRangeMeters: 0 }),
    ]).features;

    expect(feature.properties.rangeMeters).toBe(0);
  });

  it('yields an empty collection for an empty input', () => {
    const collection = toFeatureCollection([]);

    expect(collection.type).toBe('FeatureCollection');
    expect(collection.features).toEqual([]);
  });

  it('preserves the input order', () => {
    const collection = toFeatureCollection([
      vehicle('a'),
      vehicle('b'),
      vehicle('c'),
    ]);

    expect(collection.features.map(f => f.properties.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('does not mutate the input', () => {
    const vehicles = [vehicle('a'), vehicle('b')];
    const before = structuredClone(vehicles);

    toFeatureCollection(vehicles);

    expect(vehicles).toEqual(before);
  });

  it('allocates a new collection on each call', () => {
    const vehicles = [vehicle('a')];

    expect(toFeatureCollection(vehicles)).not.toBe(
      toFeatureCollection(vehicles)
    );
  });
});
