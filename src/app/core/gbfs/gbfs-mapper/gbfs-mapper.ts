import { Service } from '@angular/core';
import type {
  Vehicle,
  VehicleSnapshot,
  VehicleStatus,
} from '@core/models/vehicle.model';
import type { RawFeed, RawVehicle } from '../gbfs.types';

/** Fallback when the feed omits `ttl`. Matches what the Lime feed advertises. */
const DEFAULT_TTL_MS = 60_000;

/** Seconds-vs-milliseconds cutoff: 1e11 seconds is the year 5138. */
const MS_THRESHOLD = 1e11;

/**
 * An unusable envelope: a feed or provider fault rather than a bad data point.
 * A single malformed vehicle is dropped and counted instead of thrown.
 */
export class GbfsMapperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GbfsMapperError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRawFeed(raw: unknown): raw is RawFeed {
  return isRecord(raw) && isRecord(raw['data']);
}

/** GBFS 2.2 calls them `bikes`; 3.x renamed the key to `vehicles`. */
function vehicleItems(feed: RawFeed): unknown[] {
  const bikes = feed.data?.bikes;
  if (Array.isArray(bikes)) {
    return bikes;
  }
  const vehicles = feed.data?.vehicles;
  if (Array.isArray(vehicles)) {
    return vehicles;
  }
  throw new GbfsMapperError(
    'Feed envelope exposes neither data.bikes nor data.vehicles as an array'
  );
}

function toTtlMs(ttl: unknown): number {
  return typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0
    ? ttl * 1000
    : DEFAULT_TTL_MS;
}

/**
 * GBFS 2.2 sends POSIX seconds, 3.x sends RFC3339 strings; the domain speaks
 * milliseconds. A numeric value past MS_THRESHOLD is already in milliseconds —
 * GBFS mandates seconds, so this only guards against a non-conforming provider
 * whose vehicles would otherwise land in the year 57000.
 */
function toEpochMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > MS_THRESHOLD ? value : value * 1000;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function isWithin(value: unknown, limit: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= -limit &&
    value <= limit
  );
}

function toStatus(item: RawVehicle): VehicleStatus {
  if (item.is_disabled === true) {
    return 'disabled';
  }
  return item.is_reserved === true ? 'reserved' : 'available';
}

/**
 * Returns `undefined` for an item the domain cannot represent, which the caller
 * counts as a drop. A coordinate outside its range is rejected as well as a
 * missing one: a misparsed `0, 0` is a valid number that would stretch the map
 * across the Atlantic.
 */
function toVehicle(raw: unknown): Vehicle | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const item: RawVehicle = raw;

  const id = item.bike_id ?? item.vehicle_id; // 2.2 renamed to vehicle_id in 3.x
  if (typeof id !== 'string') {
    return undefined;
  }
  if (!isWithin(item.lat, 90) || !isWithin(item.lon, 180)) {
    return undefined;
  }

  return {
    id,
    coordinates: { lat: item.lat, lon: item.lon },
    status: toStatus(item),
    isReserved: item.is_reserved === true,
    isDisabled: item.is_disabled === true,
    vehicleTypeId: toOptionalString(item.vehicle_type_id),
    vehicleType: toOptionalString(item.vehicle_type),
    currentRangeMeters: toOptionalNumber(item.current_range_meters),
    lastReported: toEpochMs(item.last_reported),
  };
}

/**
 * The single translation boundary between the GBFS schema and the domain.
 * Swapping provider or GBFS version must not require changes above this layer.
 */
@Service()
export class GbfsMapper {
  toSnapshot(raw: unknown): VehicleSnapshot {
    if (!isRawFeed(raw)) {
      throw new GbfsMapperError(
        'Feed payload is not an object with a data key'
      );
    }

    const vehicles: Vehicle[] = [];
    let droppedCount = 0;
    for (const item of vehicleItems(raw)) {
      const vehicle = toVehicle(item);
      if (vehicle) {
        vehicles.push(vehicle);
      } else {
        droppedCount++;
      }
    }

    return {
      vehicles,
      lastUpdated: toEpochMs(raw.last_updated) ?? 0,
      ttlMs: toTtlMs(raw.ttl),
      droppedCount,
    };
  }
}
