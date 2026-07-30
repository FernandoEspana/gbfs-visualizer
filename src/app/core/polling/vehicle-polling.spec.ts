import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Subscription } from 'rxjs';
import { GBFS_FEED_URL } from '../gbfs/gbfs-feed-url';
import limeFeed from '../gbfs/__fixtures__/lime-free-bike-status.json';
import type { VehicleSnapshot } from '../models/vehicle.model';
import type { PollError, PollResult } from './poll-result';
import { RANDOM } from './random';
import { VehiclePolling } from './vehicle-polling';

const FEED_URL = '/api/gbfs/free_bike_status.json';

/** Nominal backoff delays, given a RANDOM stubbed to the midpoint. */
const BACKOFF_MS = [1000, 2000, 4000];

function asSuccess(result: PollResult): VehicleSnapshot {
  if (result.kind !== 'success') {
    throw new Error(`expected a success result, got ${result.error.kind}`);
  }
  return result.snapshot;
}

function asError(result: PollResult): PollError {
  if (result.kind !== 'error') {
    throw new Error('expected an error result, got a success');
  }
  return result.error;
}

describe('VehiclePolling', () => {
  let polling: VehiclePolling;
  let httpMock: HttpTestingController;
  let results: PollResult[];
  let subscription: Subscription | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: GBFS_FEED_URL, useValue: FEED_URL },
        { provide: RANDOM, useValue: () => 0.5 },
      ],
    });
    polling = TestBed.inject(VehiclePolling);
    httpMock = TestBed.inject(HttpTestingController);
    results = [];
  });

  afterEach(() => {
    subscription?.unsubscribe();
    httpMock.verify({ ignoreCancelled: true });
    vi.useRealTimers();
  });

  function subscribe(): void {
    subscription = polling.snapshots$.subscribe(result => results.push(result));
  }

  /** `expectOne` takes the request off the queue, so a hung one leaks nothing. */
  function fail(status = 503): void {
    httpMock
      .expectOne(FEED_URL)
      .flush('down', { status, statusText: 'Service Unavailable' });
  }

  describe('one tick', () => {
    it('emits a success carrying the mapped snapshot', () => {
      subscribe();
      httpMock.expectOne(FEED_URL).flush(limeFeed);

      expect(results).toHaveLength(1);
      const snapshot = asSuccess(results[0]);
      expect(snapshot.vehicles).toHaveLength(limeFeed.data.bikes.length);
      expect(snapshot.ttlMs).toBe(60_000);
      expect(snapshot.droppedCount).toBe(0);
    });

    it('emits a schema error without retrying', () => {
      subscribe();
      httpMock.expectOne(FEED_URL).flush({ nothing: 'useful' });

      expect(results).toHaveLength(1);
      const error = asError(results[0]);
      expect(error.kind).toBe('schema');
      expect(error.attempts).toBe(1);

      // The whole backoff window, well short of the next tick.
      vi.advanceTimersByTime(7_000);
      httpMock.expectNone(FEED_URL);
    });
  });

  describe('retry and backoff', () => {
    it('reports a failure as a value instead of erroring the stream', () => {
      let errored = false;
      subscription = polling.snapshots$.subscribe({
        next: result => results.push(result),
        error: () => (errored = true),
      });

      fail();
      for (const delay of BACKOFF_MS) {
        vi.advanceTimersByTime(delay);
        fail();
      }

      expect(errored).toBe(false);
      expect(results).toHaveLength(1);
      const error = asError(results[0]);
      expect(error.kind).toBe('http');
      expect(error.status).toBe(503);
      expect(error.attempts).toBe(4);
    });

    it('emits one success when a retry recovers', () => {
      subscribe();
      fail();

      vi.advanceTimersByTime(1000);
      fail();

      vi.advanceTimersByTime(2000);
      httpMock.expectOne(FEED_URL).flush(limeFeed);

      expect(results).toHaveLength(1);
      expect(asSuccess(results[0]).droppedCount).toBe(0);
    });

    it('spaces the retries by 1s, 2s and 4s', () => {
      subscribe();
      fail();

      for (const delay of BACKOFF_MS) {
        vi.advanceTimersByTime(delay - 1);
        httpMock.expectNone(FEED_URL);

        vi.advanceTimersByTime(1);
        fail();
      }

      expect(results).toHaveLength(1);
    });

    it('starts each tick with a fresh retry budget', () => {
      subscribe();
      fail();
      for (const delay of BACKOFF_MS) {
        vi.advanceTimersByTime(delay);
        fail();
      }
      expect(asError(results[0]).attempts).toBe(4);

      vi.advanceTimersByTime(60_000);
      fail();
      for (const delay of BACKOFF_MS) {
        vi.advanceTimersByTime(delay);
        fail();
      }

      expect(results).toHaveLength(2);
      expect(asError(results[1]).attempts).toBe(4);
    });

    it('gives each attempt its own timeout window', () => {
      subscribe();
      httpMock.expectOne(FEED_URL);

      vi.advanceTimersByTime(14_999);
      expect(results).toHaveLength(0);
      vi.advanceTimersByTime(1);

      for (const delay of BACKOFF_MS) {
        expect(results).toHaveLength(0);
        vi.advanceTimersByTime(delay);
        httpMock.expectOne(FEED_URL);
        vi.advanceTimersByTime(15_000);
      }

      expect(results).toHaveLength(1);
      const error = asError(results[0]);
      expect(error.kind).toBe('network');
      expect(error.attempts).toBe(4);
    });
  });

  describe('interval', () => {
    it('issues the first request without waiting', () => {
      subscribe();

      httpMock.expectOne(FEED_URL).flush(limeFeed);
      expect(results).toHaveLength(1);
    });

    it('waits the advertised ttl before the next request', () => {
      subscribe();
      httpMock.expectOne(FEED_URL).flush(limeFeed);

      vi.advanceTimersByTime(59_999);
      httpMock.expectNone(FEED_URL);

      vi.advanceTimersByTime(1);
      httpMock.expectOne(FEED_URL).flush(limeFeed);
      expect(results).toHaveLength(2);
    });

    it('follows a feed that advertises a shorter ttl', () => {
      subscribe();
      httpMock.expectOne(FEED_URL).flush({ ...limeFeed, ttl: 30 });

      vi.advanceTimersByTime(29_999);
      httpMock.expectNone(FEED_URL);

      vi.advanceTimersByTime(1);
      httpMock.expectOne(FEED_URL);
    });

    it('keeps ticking after a failed tick', () => {
      subscribe();
      fail();
      for (const delay of BACKOFF_MS) {
        vi.advanceTimersByTime(delay);
        fail();
      }

      vi.advanceTimersByTime(60_000);
      httpMock.expectOne(FEED_URL).flush(limeFeed);

      expect(results).toHaveLength(2);
      expect(results[0].kind).toBe('error');
      expect(results[1].kind).toBe('success');
    });

    it('reuses the last known good ttl after a failure', () => {
      subscribe();
      httpMock.expectOne(FEED_URL).flush({ ...limeFeed, ttl: 30 });

      vi.advanceTimersByTime(30_000);
      fail();
      for (const delay of BACKOFF_MS) {
        vi.advanceTimersByTime(delay);
        fail();
      }

      vi.advanceTimersByTime(29_999);
      httpMock.expectNone(FEED_URL);

      vi.advanceTimersByTime(1);
      httpMock.expectOne(FEED_URL);
    });

    it('never completes', () => {
      let completed = false;
      subscription = polling.snapshots$.subscribe({
        next: result => results.push(result),
        complete: () => (completed = true),
      });

      httpMock.expectOne(FEED_URL).flush(limeFeed);
      vi.advanceTimersByTime(60_000);
      httpMock.expectOne(FEED_URL).flush(limeFeed);

      expect(completed).toBe(false);
      expect(results).toHaveLength(2);
    });

    it('cancels the in-flight request and stops on unsubscribe', () => {
      subscribe();
      httpMock.expectOne(FEED_URL);

      subscription?.unsubscribe();

      vi.advanceTimersByTime(120_000);
      httpMock.expectNone(FEED_URL);
      expect(results).toHaveLength(0);
    });
  });
});
