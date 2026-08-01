import { TestBed } from '@angular/core/testing';
import { GbfsMapper, GbfsMapperError } from './gbfs-mapper';
import limeFeed from '../__fixtures__/lime-free-bike-status.json';

describe('GbfsMapper', () => {
  let mapper: GbfsMapper;

  beforeEach(() => {
    mapper = TestBed.inject(GbfsMapper);
  });

  describe('envelope', () => {
    it('accepts a GBFS 2.2 envelope keyed on data.bikes', () => {
      const snapshot = mapper.toSnapshot(limeFeed);

      expect(snapshot.lastUpdated).toBe(limeFeed.last_updated * 1000);
      expect(snapshot.ttlMs).toBe(60_000);
      expect(snapshot.droppedCount).toBe(0);
      expect(snapshot.vehicles).toHaveLength(limeFeed.data.bikes.length);
    });

    it('accepts a GBFS 3.x envelope keyed on data.vehicles', () => {
      const snapshot = mapper.toSnapshot({
        last_updated: 1785363766,
        ttl: 60,
        data: { vehicles: [] },
      });

      expect(snapshot.lastUpdated).toBe(1785363766000);
      expect(snapshot.ttlMs).toBe(60_000);
    });

    it('falls back to a 60s ttl when the feed omits it', () => {
      const snapshot = mapper.toSnapshot({ data: { bikes: [] } });

      expect(snapshot.ttlMs).toBe(60_000);
    });

    it('falls back to 0 when the feed omits last_updated', () => {
      const snapshot = mapper.toSnapshot({ ttl: 60, data: { bikes: [] } });

      expect(snapshot.lastUpdated).toBe(0);
    });

    it('throws when the payload is not an object', () => {
      expect(() => mapper.toSnapshot(null)).toThrow(GbfsMapperError);
      expect(() => mapper.toSnapshot('nope')).toThrow(GbfsMapperError);
      expect(() => mapper.toSnapshot([])).toThrow(GbfsMapperError);
    });

    it('throws when the payload carries no data key', () => {
      expect(() => mapper.toSnapshot({})).toThrow(GbfsMapperError);
      expect(() => mapper.toSnapshot({ ttl: 60 })).toThrow(GbfsMapperError);
    });

    it('throws when neither bikes nor vehicles is an array', () => {
      expect(() => mapper.toSnapshot({ data: {} })).toThrow(GbfsMapperError);
      expect(() => mapper.toSnapshot({ data: { bikes: 'nope' } })).toThrow(
        GbfsMapperError
      );
    });
  });

  describe('item mapping, GBFS 2.2', () => {
    it('maps a real fixture item field by field', () => {
      const [first] = mapper.toSnapshot(limeFeed).vehicles;

      expect(first).toEqual({
        id: '41cd0a00-9cc3-4ec8-90a6-e4df2e6c17f7',
        coordinates: { lat: 40.668495, lon: -73.796385 },
        status: 'available',
        isReserved: false,
        isDisabled: false,
        vehicleTypeId: '2',
        vehicleType: 'scooter',
        currentRangeMeters: 0,
        lastReported: 1785363718000,
      });
    });

    it('never populates stationId from a free-floating feed', () => {
      const { vehicles } = mapper.toSnapshot(limeFeed);

      expect(vehicles.every(v => v.stationId === undefined)).toBe(true);
    });

    it('preserves the full range spread of the fixture', () => {
      const { vehicles } = mapper.toSnapshot(limeFeed);
      const ranges = vehicles.map(v => v.currentRangeMeters);

      expect(Math.min(...(ranges as number[]))).toBe(0);
      expect(Math.max(...(ranges as number[]))).toBe(39461);
    });
  });

  describe('item mapping, GBFS 3.x', () => {
    /**
     * The same fixture in 3.x clothing: `bikes` becomes `vehicles`, `bike_id`
     * becomes `vehicle_id`, and POSIX seconds become RFC3339 strings.
     */
    const asGbfs3 = (feed: typeof limeFeed) => ({
      last_updated: new Date(feed.last_updated * 1000).toISOString(),
      ttl: feed.ttl,
      version: '3.0',
      data: {
        vehicles: feed.data.bikes.map(
          ({ bike_id, last_reported, ...rest }) => ({
            ...rest,
            vehicle_id: bike_id,
            last_reported: new Date(last_reported * 1000).toISOString(),
          })
        ),
      },
    });

    it('produces vehicles identical to the 2.2 dialect', () => {
      const from22 = mapper.toSnapshot(limeFeed);
      const from3x = mapper.toSnapshot(asGbfs3(limeFeed));

      expect(from3x.vehicles).toEqual(from22.vehicles);
      expect(from3x.lastUpdated).toBe(from22.lastUpdated);
      expect(from3x.droppedCount).toBe(0);
    });

    it('reads the id from vehicle_id when bike_id is absent', () => {
      const { vehicles } = mapper.toSnapshot({
        data: { vehicles: [{ vehicle_id: 'v-1', lat: 40.7, lon: -73.9 }] },
      });

      expect(vehicles[0]?.id).toBe('v-1');
    });
  });

  describe('states the live feed never produces', () => {
    const base = { bike_id: 'x-1', lat: 40.7, lon: -73.9 };
    const snapshotOf = (...bikes: unknown[]) =>
      mapper.toSnapshot({ last_updated: 1785363766, ttl: 60, data: { bikes } });

    it('maps a reserved vehicle', () => {
      const [vehicle] = snapshotOf({ ...base, is_reserved: true }).vehicles;

      expect(vehicle?.status).toBe('reserved');
      expect(vehicle?.isReserved).toBe(true);
      expect(vehicle?.isDisabled).toBe(false);
    });

    it('maps a disabled vehicle', () => {
      const [vehicle] = snapshotOf({ ...base, is_disabled: true }).vehicles;

      expect(vehicle?.status).toBe('disabled');
      expect(vehicle?.isReserved).toBe(false);
      expect(vehicle?.isDisabled).toBe(true);
    });

    it('lets disabled win over reserved without losing either flag', () => {
      const [vehicle] = snapshotOf({
        ...base,
        is_reserved: true,
        is_disabled: true,
      }).vehicles;

      expect(vehicle?.status).toBe('disabled');
      expect(vehicle?.isReserved).toBe(true);
      expect(vehicle?.isDisabled).toBe(true);
    });

    it('keeps a vehicle whose optional fields are absent', () => {
      const snapshot = snapshotOf(base);

      expect(snapshot.droppedCount).toBe(0);
      expect(snapshot.vehicles[0]?.currentRangeMeters).toBeUndefined();
      expect(snapshot.vehicles[0]?.vehicleType).toBeUndefined();
      expect(snapshot.vehicles[0]?.lastReported).toBeUndefined();
    });
  });

  describe('dropped items', () => {
    const base = { bike_id: 'x-1', lat: 40.7, lon: -73.9 };
    const snapshotOf = (...bikes: unknown[]) =>
      mapper.toSnapshot({ data: { bikes } });

    it('drops and counts an item with no latitude', () => {
      const { bike_id, lon } = base;
      const snapshot = snapshotOf({ bike_id, lon });

      expect(snapshot.vehicles).toHaveLength(0);
      expect(snapshot.droppedCount).toBe(1);
    });

    it('drops and counts an out-of-range longitude', () => {
      const snapshot = snapshotOf({ ...base, lon: 999 });

      expect(snapshot.vehicles).toHaveLength(0);
      expect(snapshot.droppedCount).toBe(1);
    });

    it('drops and counts a non-string id', () => {
      const snapshot = snapshotOf({ ...base, bike_id: 42 });

      expect(snapshot.vehicles).toHaveLength(0);
      expect(snapshot.droppedCount).toBe(1);
    });

    it('drops and counts an item that is not an object', () => {
      const snapshot = snapshotOf(null, 'nope');

      expect(snapshot.vehicles).toHaveLength(0);
      expect(snapshot.droppedCount).toBe(2);
    });

    it('keeps the valid items alongside the dropped ones', () => {
      const snapshot = snapshotOf(base, { ...base, lat: 91 });

      expect(snapshot.vehicles).toHaveLength(1);
      expect(snapshot.droppedCount).toBe(1);
    });

    it('returns an empty snapshot for an empty feed without throwing', () => {
      const snapshot = snapshotOf();

      expect(snapshot.vehicles).toHaveLength(0);
      expect(snapshot.droppedCount).toBe(0);
      expect(snapshot.ttlMs).toBe(60_000);
    });
  });

  describe('timestamp normalization', () => {
    const withLastUpdated = (last_updated: unknown): number =>
      mapper.toSnapshot({ last_updated, data: { bikes: [] } }).lastUpdated;

    it('scales POSIX seconds to milliseconds', () => {
      expect(withLastUpdated(1785363766)).toBe(1785363766000);
    });

    it('passes a millisecond-scale integer through unscaled', () => {
      expect(withLastUpdated(1785363766000)).toBe(1785363766000);
    });

    it('parses an RFC3339 string in UTC', () => {
      expect(withLastUpdated('2026-07-29T14:30:00Z')).toBe(1785335400000);
    });

    it('parses an RFC3339 string with a numeric offset', () => {
      expect(withLastUpdated('2026-07-29T16:30:00+02:00')).toBe(
        withLastUpdated('2026-07-29T14:30:00Z')
      );
    });

    it('rejects an unparseable string', () => {
      expect(withLastUpdated('not a timestamp')).toBe(0);
    });

    it('rejects a non-numeric, non-string value', () => {
      expect(withLastUpdated(null)).toBe(0);
      expect(withLastUpdated(true)).toBe(0);
      expect(withLastUpdated(Number.NaN)).toBe(0);
    });
  });
});
