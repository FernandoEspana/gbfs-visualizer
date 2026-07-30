import { computed, DestroyRef, inject, signal, Service } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Subscription } from 'rxjs';
import type { Vehicle, VehicleSnapshot } from '../models/vehicle.model';
import type { PollError, PollResult } from '../polling/poll-result';
import { VehiclePolling } from '../polling/vehicle-polling';
import type { StoreStatus } from './store-status';

/** One frozen instance, so `vehicles()` is referentially stable while empty. */
const EMPTY_VEHICLES: readonly Vehicle[] = Object.freeze([]);

/**
 * The single source of truth for feed state. Every public member is a
 * `computed()` over the private signals below, so no two of them can disagree.
 */
@Service()
export class VehicleStore {
  readonly #polling = inject(VehiclePolling);
  readonly #destroyRef = inject(DestroyRef);

  readonly #snapshot = signal<VehicleSnapshot | null>(null);
  readonly #error = signal<PollError | null>(null);
  readonly #selectedId = signal<string | null>(null);
  readonly #started = signal(false);

  #subscription: Subscription | null = null;

  /**
   * Once a snapshot exists an error never changes the status: the UI keeps the
   * data it has and renders a banner over it.
   */
  readonly status = computed<StoreStatus>(() => {
    if (!this.#started()) return 'idle';

    const snapshot = this.#snapshot();
    if (snapshot === null) return this.#error() === null ? 'loading' : 'error';

    return snapshot.vehicles.length === 0 ? 'empty' : 'loaded';
  });

  readonly vehicles = computed<readonly Vehicle[]>(
    () => this.#snapshot()?.vehicles ?? EMPTY_VEHICLES
  );

  readonly error = computed(() => this.#error());

  readonly lastUpdated = computed(() => this.#snapshot()?.lastUpdated ?? null);

  readonly droppedCount = computed(() => this.#snapshot()?.droppedCount ?? 0);

  /** Resolved against the live snapshot, so it can never age into a lie. */
  readonly selected = computed<Vehicle | undefined>(() => {
    const id = this.#selectedId();
    if (id === null) return undefined;

    return this.#snapshot()?.vehicles.find(v => v.id === id);
  });

  /** Before the first snapshot a selection is pending, not lost. */
  readonly selectionLost = computed(
    () =>
      this.#selectedId() !== null &&
      this.#snapshot() !== null &&
      this.selected() === undefined
  );

  /** Idempotent: a second call is a no-op, so any caller may start the feed. */
  start(): void {
    if (this.#started()) return;

    this.#started.set(true);
    this.#subscribe();
  }

  /**
   * Resubscribing is the out-of-band tick: `snapshots$` is cold and its first
   * tick has no delay. Before `start()` there is nothing to refresh.
   */
  refresh(): void {
    if (!this.#started()) return;

    this.#subscription?.unsubscribe();
    this.#subscribe();
  }

  /** Selecting the same id twice is not a toggle: both map and list send it. */
  select(id: string): void {
    this.#selectedId.set(id);
  }

  clearSelection(): void {
    this.#selectedId.set(null);
  }

  #subscribe(): void {
    this.#subscription = this.#polling.snapshots$
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe(result => this.#ingest(result));
  }

  #ingest(result: PollResult): void {
    if (result.kind === 'success') {
      this.#snapshot.set(result.snapshot);
      this.#error.set(null);
      return;
    }

    // The snapshot is left alone: stale data beats a blank map.
    this.#error.set(result.error);
  }
}
