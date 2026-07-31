import type { Feature, FeatureCollection, Point } from 'geojson';
import type { Vehicle } from '../models/vehicle.model';

export interface VehicleFeatureProperties {
  id: string;
  rangeMeters: number;
}

/**
 * Stands in for an absent `currentRangeMeters`: a `step` expression cannot
 * branch on a missing property, and a negative range is not representable, so
 * this value falls below the first stop and lands on `UNKNOWN_RANGE_COLOR`.
 */
export const UNKNOWN_RANGE_METERS = -1;

export type VehicleCollection = FeatureCollection<
  Point,
  VehicleFeatureProperties
>;

/**
 * Projects the domain model into GeoJSON. The only place where the domain's
 * `{ lat, lon }` meets GeoJSON's `[lon, lat]`.
 */
export function toFeatureCollection(
  vehicles: readonly Vehicle[]
): VehicleCollection {
  return {
    type: 'FeatureCollection',
    features: vehicles.map(toFeature),
  };
}

function toFeature(vehicle: Vehicle): Feature<Point, VehicleFeatureProperties> {
  return {
    type: 'Feature',
    // MapLibre needs the identity here; the click handler reads the property,
    // which survives tile encoding.
    id: vehicle.id,
    geometry: {
      type: 'Point',
      coordinates: [vehicle.coordinates.lon, vehicle.coordinates.lat],
    },
    properties: {
      id: vehicle.id,
      rangeMeters: vehicle.currentRangeMeters ?? UNKNOWN_RANGE_METERS,
    },
  };
}
