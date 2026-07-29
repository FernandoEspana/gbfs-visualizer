export type VehicleStatus = 'available' | 'reserved' | 'disabled';

export interface Vehicle {
  id: string;
  coordinates: { lat: number; lon: number };
  status: VehicleStatus;
  isReserved: boolean;
  isDisabled: boolean;
  vehicleTypeId?: string;
  vehicleType?: string;
  currentRangeMeters?: number;
  lastReported?: number; // epoch milliseconds
  stationId?: string; // never populated by a free-floating feed
}

/** One fetch of the feed. `ttlMs` is what the polling interval aligns to. */
export interface VehicleSnapshot {
  vehicles: readonly Vehicle[];
  lastUpdated: number; // epoch milliseconds
  ttlMs: number;
  droppedCount: number;
}
