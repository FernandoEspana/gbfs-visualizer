import { inject, Service } from '@angular/core';
import {
  catchError,
  defer,
  map,
  of,
  repeat,
  retry,
  tap,
  throwError,
  timeout,
  timer,
  type Observable,
} from 'rxjs';
import { GbfsApi } from '@core/gbfs/gbfs-api/gbfs-api';
import {
  GbfsMapper,
  GbfsMapperError,
} from '@core/gbfs/gbfs-mapper/gbfs-mapper';
import { backoffDelay } from '../backoff/backoff';
import { toPollError } from '../poll-error/poll-error';
import type { PollResult } from '../poll-result';
import { RANDOM } from '../random';

/** A hung connection is otherwise indistinguishable from a slow one. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Three retries plus the initial attempt fit inside one 60s ttl. */
const MAX_RETRIES = 3;

/** Until a snapshot advertises its own `ttl`. Matches what Lime sends. */
const DEFAULT_INTERVAL_MS = 60_000;

/**
 * The live data layer: fetch, translate, and hand the result on as a value.
 *
 * `snapshots$` is cold, never errors and never completes. A failure travels as
 * `{ kind: 'error' }` so the stream outlives the outage it is reporting.
 */
@Service()
export class VehiclePolling {
  readonly #api = inject(GbfsApi);
  readonly #mapper = inject(GbfsMapper);
  readonly #random = inject(RANDOM);

  /**
   * The delay is measured from tick completion, not tick start, so a slow feed
   * pushes the next request back instead of stacking one on top of it.
   */
  readonly snapshots$: Observable<PollResult> = defer(() => {
    let intervalMs = DEFAULT_INTERVAL_MS;

    return this.#tick().pipe(
      tap(result => {
        if (result.kind === 'success') {
          intervalMs = result.snapshot.ttlMs;
        }
      }),
      repeat({ delay: () => timer(intervalMs) })
    );
  });

  /**
   * One tick, retries included. The budget is per tick, so a stream left
   * running overnight does not run out of retries after three transient blips.
   */
  #tick(): Observable<PollResult> {
    return defer(() => this.#attempt());
  }

  #attempt(): Observable<PollResult> {
    let attempts = 0;

    return defer(() => {
      attempts += 1;
      return this.#api.fetchVehicleStatus();
    }).pipe(
      timeout(REQUEST_TIMEOUT_MS),
      map((raw): PollResult => ({
        kind: 'success',
        snapshot: this.#mapper.toSnapshot(raw),
      })),
      retry({
        count: MAX_RETRIES,
        // A corrupt envelope is deterministic: three identical requests would
        // produce three identical failures and only delay the error state.
        delay: (cause: unknown, retryCount) =>
          cause instanceof GbfsMapperError
            ? throwError(() => cause)
            : timer(backoffDelay(retryCount - 1, this.#random)),
      }),
      catchError((cause: unknown) =>
        of<PollResult>({ kind: 'error', error: toPollError(cause, attempts) })
      )
    );
  }
}
