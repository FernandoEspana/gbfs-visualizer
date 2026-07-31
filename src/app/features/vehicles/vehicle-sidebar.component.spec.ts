import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Observable, Subject } from 'rxjs';
import type { Vehicle, VehicleSnapshot } from '../../core/models/vehicle.model';
import type { PollError, PollResult } from '../../core/polling/poll-result';
import { VehiclePolling } from '../../core/polling/vehicle-polling';
import { VehicleStore } from '../../core/state/vehicle-store';
import { NOW } from '../../core/time/now';
import { VehicleSidebarComponent } from './vehicle-sidebar.component';

const NOW_MS = 1_700_000_000_000;

function vehicle(id: string): Vehicle {
  return {
    id,
    coordinates: { lat: 40.7, lon: -73.8 },
    status: 'available',
    isReserved: false,
    isDisabled: false,
    currentRangeMeters: 12_000,
    lastReported: NOW_MS - 120_000,
  };
}

function snapshot(ids: readonly string[]): VehicleSnapshot {
  return {
    vehicles: ids.map(vehicle),
    lastUpdated: NOW_MS - 60_000,
    ttlMs: 60_000,
    droppedCount: 0,
  };
}

const POLL_ERROR: PollError = {
  kind: 'network',
  message: 'offline',
  attempts: 4,
  at: NOW_MS,
};

/**
 * The real store over a stubbed feed, so the branches are driven by the same
 * state machine the app runs on rather than by a hand-set status.
 */
async function setup() {
  // jsdom implements no scrolling at all, and the real list reveals a selection
  // by scrolling to it. Without this the effect throws on every selection.
  Element.prototype.scrollTo = () => undefined;

  let results = new Subject<PollResult>();
  let subscriptions = 0;

  const snapshots$ = new Observable<PollResult>(subscriber => {
    subscriptions++;
    const stream = new Subject<PollResult>();
    results = stream;
    return stream.subscribe(subscriber);
  });
  const polling: Pick<VehiclePolling, 'snapshots$'> = { snapshots$ };

  await TestBed.configureTestingModule({
    imports: [VehicleSidebarComponent],
    providers: [
      { provide: VehiclePolling, useValue: polling },
      { provide: NOW, useValue: () => NOW_MS },
    ],
  }).compileComponents();

  const store = TestBed.inject(VehicleStore);
  const fixture: ComponentFixture<VehicleSidebarComponent> =
    TestBed.createComponent(VehicleSidebarComponent);

  const flush = async () => {
    for (let round = 0; round < 2; round++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };

  await flush();

  const host = fixture.nativeElement as HTMLElement;

  const emit = async (result: PollResult) => {
    results.next(result);
    await flush();
  };

  return {
    fixture,
    host,
    store,
    flush,
    emit,
    text: () => host.textContent ?? '',
    subscriptionCount: () => subscriptions,
    retryButton: () =>
      Array.from(host.querySelectorAll('button')).find(
        button => button.textContent?.trim() === 'Retry'
      ),
  };
}

describe('VehicleSidebarComponent', () => {
  it('shows the loading skeleton and no list before the first snapshot', async () => {
    const { host, store, flush, text } = await setup();

    store.start();
    await flush();

    expect(host.querySelectorAll('.skeleton-row').length).toBeGreaterThan(0);
    expect(host.querySelector('app-vehicle-list')).toBeNull();
    expect(text()).toContain('Loading vehicles');
  });

  it('shows the list once a snapshot lands', async () => {
    const { host, store, flush, emit } = await setup();
    store.start();
    await flush();

    await emit({ kind: 'success', snapshot: snapshot(['a', 'b']) });

    expect(host.querySelector('app-vehicle-list')).not.toBeNull();
    expect(host.querySelector('.skeleton-row')).toBeNull();
  });

  it('shows the empty message rather than an empty list', async () => {
    const { host, store, flush, emit, text } = await setup();
    store.start();
    await flush();

    await emit({ kind: 'success', snapshot: snapshot([]) });

    expect(text()).toContain('no vehicles');
    expect(host.querySelector('app-vehicle-list')).toBeNull();
    expect(host.querySelector('.skeleton-row')).toBeNull();
  });

  it('shows the error branch and a retry when the first fetch fails', async () => {
    const { host, store, flush, emit, retryButton } = await setup();
    store.start();
    await flush();

    await emit({ kind: 'error', error: POLL_ERROR });

    expect(retryButton()).toBeDefined();
    expect(host.querySelector('app-vehicle-list')).toBeNull();
  });

  it('resubscribes exactly once per click on retry', async () => {
    const { store, flush, emit, retryButton, subscriptionCount } =
      await setup();
    store.start();
    await flush();
    await emit({ kind: 'error', error: POLL_ERROR });
    const before = subscriptionCount();

    retryButton()?.click();
    await flush();

    expect(subscriptionCount() - before).toBe(1);
  });

  it('replaces the error branch with the list when the retry succeeds', async () => {
    const { host, store, flush, emit, retryButton } = await setup();
    store.start();
    await flush();
    await emit({ kind: 'error', error: POLL_ERROR });

    retryButton()?.click();
    await flush();
    await emit({ kind: 'success', snapshot: snapshot(['a']) });

    expect(host.querySelector('app-vehicle-list')).not.toBeNull();
    expect(retryButton()).toBeUndefined();
  });

  it('keeps the list on an error that arrives after a snapshot', async () => {
    const { host, store, flush, emit, retryButton } = await setup();
    store.start();
    await flush();
    await emit({ kind: 'success', snapshot: snapshot(['a']) });

    await emit({ kind: 'error', error: POLL_ERROR });

    expect(host.querySelector('app-vehicle-list')).not.toBeNull();
    expect(retryButton()).toBeUndefined();
  });

  it('renders the count and the update time once there is data', async () => {
    const { store, flush, emit, text } = await setup();
    store.start();
    await flush();

    await emit({ kind: 'success', snapshot: snapshot(['a', 'b', 'c']) });

    expect(text()).toContain('3 vehicles');
    expect(text()).toContain('updated 1 min ago');
  });

  it('opens the detail panel for the selected vehicle', async () => {
    const { host, store, flush, emit } = await setup();
    store.start();
    await flush();
    await emit({ kind: 'success', snapshot: snapshot(['a', 'b']) });

    store.select('b');
    await flush();

    expect(host.querySelector('app-vehicle-detail-panel')).not.toBeNull();
  });

  it('has no panel in the DOM without a selection', async () => {
    const { host, store, flush, emit } = await setup();
    store.start();
    await flush();

    await emit({ kind: 'success', snapshot: snapshot(['a']) });

    expect(host.querySelector('app-vehicle-detail-panel')).toBeNull();
  });

  it('keeps the panel open when the feed loses the selected vehicle', async () => {
    const { host, store, flush, emit, text } = await setup();
    store.start();
    await flush();
    await emit({ kind: 'success', snapshot: snapshot(['a', 'b']) });
    store.select('b');
    await flush();

    await emit({ kind: 'success', snapshot: snapshot(['a']) });

    expect(host.querySelector('app-vehicle-detail-panel')).not.toBeNull();
    expect(text()).toContain('no longer in the feed');
  });

  it('closes the panel when the panel asks to close', async () => {
    const { host, store, flush, emit } = await setup();
    store.start();
    await flush();
    await emit({ kind: 'success', snapshot: snapshot(['a']) });
    store.select('a');
    await flush();

    host
      .querySelector<HTMLButtonElement>('app-vehicle-detail-panel button')
      ?.click();
    await flush();

    expect(host.querySelector('app-vehicle-detail-panel')).toBeNull();
    expect(store.selected()).toBeUndefined();
  });
});
