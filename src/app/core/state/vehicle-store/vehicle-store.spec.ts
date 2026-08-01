import { TestBed } from '@angular/core/testing';
import { Observable, Subject } from 'rxjs';
import type { Vehicle, VehicleSnapshot } from '../../models/vehicle.model';
import type { PollError, PollResult } from '../../polling/poll-result';
import { VehiclePolling } from '../../polling/vehicle-polling/vehicle-polling';
import { VehicleStore } from './vehicle-store';

function vehicle(id: string): Vehicle {
  return {
    id,
    coordinates: { lat: 40.7, lon: -73.8 },
    status: 'available',
    isReserved: false,
    isDisabled: false,
  };
}

function snapshot(
  ids: readonly string[],
  overrides: Partial<VehicleSnapshot> = {}
): VehicleSnapshot {
  return {
    vehicles: ids.map(vehicle),
    lastUpdated: 1_700_000_000_000,
    ttlMs: 60_000,
    droppedCount: 0,
    ...overrides,
  };
}

function success(ids: readonly string[]): PollResult {
  return { kind: 'success', snapshot: snapshot(ids) };
}

const POLL_ERROR: PollError = {
  kind: 'network',
  message: 'offline',
  attempts: 4,
  at: 1_700_000_000_000,
};

const FAILURE: PollResult = { kind: 'error', error: POLL_ERROR };

describe('VehicleStore', () => {
  let store: VehicleStore;
  /** One stream per subscription; `results` always points at the newest. */
  let streams: Subject<PollResult>[];
  let results: Subject<PollResult>;

  beforeEach(() => {
    streams = [];
    results = new Subject<PollResult>();

    const snapshots$ = new Observable<PollResult>(subscriber => {
      const stream = new Subject<PollResult>();
      streams.push(stream);
      results = stream;
      return stream.subscribe(subscriber);
    });
    const polling: Pick<VehiclePolling, 'snapshots$'> = { snapshots$ };

    TestBed.configureTestingModule({
      providers: [{ provide: VehiclePolling, useValue: polling }],
    });
    store = TestBed.inject(VehicleStore);
  });

  describe('status transitions', () => {
    it('is idle before start(), with no subscription', () => {
      expect(store.status()).toBe('idle');
      expect(streams).toHaveLength(0);
    });

    it('is loading after start() with nothing emitted', () => {
      store.start();

      expect(store.status()).toBe('loading');
      expect(store.vehicles()).toEqual([]);
      expect(store.error()).toBeNull();
    });

    it('is loaded once a snapshot carries vehicles', () => {
      store.start();
      results.next(success(['a', 'b']));

      expect(store.status()).toBe('loaded');
      expect(store.vehicles().map(v => v.id)).toEqual(['a', 'b']);
    });

    it('is empty once a snapshot carries no vehicles', () => {
      store.start();
      results.next(success([]));

      expect(store.status()).toBe('empty');
      expect(store.vehicles()).toEqual([]);
    });

    it('is error when the first emission fails', () => {
      store.start();
      results.next(FAILURE);

      expect(store.status()).toBe('error');
      expect(store.error()).toBe(POLL_ERROR);
    });

    it('leaves the error state when a snapshot finally arrives', () => {
      store.start();
      results.next(FAILURE);
      results.next(success(['a']));

      expect(store.status()).toBe('loaded');
      expect(store.error()).toBeNull();
    });
  });

  describe('stale data on error', () => {
    it('keeps the status, the vehicles and their identity across a failure', () => {
      store.start();
      results.next(success(['a', 'b']));
      const before = store.vehicles();

      results.next(FAILURE);

      expect(store.status()).toBe('loaded');
      expect(store.vehicles()).toBe(before);
      expect(store.error()).toBe(POLL_ERROR);
    });

    it('clears the error and replaces the vehicles on the next success', () => {
      store.start();
      results.next(success(['a']));
      results.next(FAILURE);
      results.next(success(['c']));

      expect(store.error()).toBeNull();
      expect(store.vehicles().map(v => v.id)).toEqual(['c']);
    });

    it('returns the same empty array instance while there is no snapshot', () => {
      expect(store.vehicles()).toBe(store.vehicles());
    });
  });

  describe('derived values', () => {
    it('reports lastUpdated and droppedCount only once a snapshot exists', () => {
      expect(store.lastUpdated()).toBeNull();
      expect(store.droppedCount()).toBe(0);

      store.start();
      results.next({
        kind: 'success',
        snapshot: snapshot(['a'], { lastUpdated: 42, droppedCount: 7 }),
      });

      expect(store.lastUpdated()).toBe(42);
      expect(store.droppedCount()).toBe(7);
    });

    it('stays loaded when a snapshot dropped some vehicles', () => {
      store.start();
      results.next({
        kind: 'success',
        snapshot: snapshot(['a'], { droppedCount: 12 }),
      });

      expect(store.status()).toBe('loaded');
    });
  });

  describe('selection', () => {
    it('resolves the selected id against the current snapshot', () => {
      store.start();
      results.next(success(['a', 'b']));

      store.select('b');

      expect(store.selected()?.id).toBe('b');
      expect(store.selectionLost()).toBe(false);
    });

    it('keeps the selection when the same id is selected twice', () => {
      store.start();
      results.next(success(['a']));

      store.select('a');
      store.select('a');

      expect(store.selected()?.id).toBe('a');
    });

    it('resolves to the new object identity after a tick that kept the id', () => {
      store.start();
      results.next(success(['a', 'b']));
      store.select('a');
      const before = store.selected();

      results.next(success(['a', 'b']));

      expect(store.selected()?.id).toBe('a');
      expect(store.selected()).not.toBe(before);
      expect(store.selectionLost()).toBe(false);
    });

    it('reports the selection lost after a tick that dropped the id', () => {
      store.start();
      results.next(success(['a', 'b']));
      store.select('a');

      results.next(success(['b']));

      expect(store.selected()).toBeUndefined();
      expect(store.selectionLost()).toBe(true);
    });

    it('resets both signals on clearSelection()', () => {
      store.start();
      results.next(success(['a']));
      store.select('a');
      results.next(success([]));

      store.clearSelection();

      expect(store.selected()).toBeUndefined();
      expect(store.selectionLost()).toBe(false);
    });

    it('treats a selection made before the first snapshot as pending', () => {
      store.start();

      store.select('a');

      expect(store.selected()).toBeUndefined();
      expect(store.selectionLost()).toBe(false);
    });

    it('is untouched by an error emission', () => {
      store.start();
      results.next(success(['a']));
      store.select('a');

      results.next(FAILURE);

      expect(store.selected()?.id).toBe('a');
      expect(store.selectionLost()).toBe(false);
    });
  });

  describe('lifecycle', () => {
    it('subscribes once however many times start() is called', () => {
      store.start();
      store.start();

      expect(streams).toHaveLength(1);
    });

    it('resubscribes on refresh() and recovers from the error', () => {
      store.start();
      results.next(FAILURE);

      store.refresh();
      results.next(success(['a']));

      expect(streams).toHaveLength(2);
      expect(store.status()).toBe('loaded');
      expect(store.error()).toBeNull();
    });

    it('stops listening to the pre-refresh stream', () => {
      store.start();
      results.next(success(['a']));
      const stale = streams[0];

      store.refresh();
      stale.next(success(['b', 'c']));

      expect(store.vehicles().map(v => v.id)).toEqual(['a']);
    });

    it('unsubscribes when the injector is destroyed', () => {
      store.start();
      results.next(success(['a']));

      TestBed.resetTestingModule();
      results.next(FAILURE);

      expect(store.status()).toBe('loaded');
      expect(store.vehicles().map(v => v.id)).toEqual(['a']);
      expect(store.error()).toBeNull();
    });

    it('is a no-op when refresh() runs before start()', () => {
      store.refresh();

      expect(store.status()).toBe('idle');
      expect(streams).toHaveLength(0);
    });
  });
});
