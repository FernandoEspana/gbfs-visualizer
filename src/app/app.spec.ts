import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { App } from './app';
import { MapLibreService } from './core/map/maplibre.service';
import type { Vehicle } from './core/models/vehicle.model';
import type { PollError } from './core/polling/poll-result';
import type { StoreStatus } from './core/state/store-status';
import { VehicleStore } from './core/state/vehicle-store/vehicle-store';
import { NOW } from './core/time/now';

const NOW_MS = 1_700_000_000_000;

const POLL_ERROR: PollError = {
  kind: 'network',
  message: 'offline',
  attempts: 4,
  at: NOW_MS,
};

describe('App', () => {
  const start = vi.fn();
  const refresh = vi.fn();
  const status = signal<StoreStatus>('loading');
  const error = signal<PollError | null>(null);
  const lastUpdated = signal<number | null>(null);
  const selected = signal<Vehicle | undefined>(undefined);
  const selectionLost = signal(false);

  beforeEach(async () => {
    start.mockClear();
    refresh.mockClear();
    status.set('loading');
    error.set(null);
    lastUpdated.set(null);
    selected.set(undefined);
    selectionLost.set(false);

    // Neither real collaborator may run here: the store reaches the network
    // the moment App is constructed, and the map needs WebGL.
    const maplibre: Pick<
      MapLibreService,
      | 'create'
      | 'destroy'
      | 'setVehicles'
      | 'setSelected'
      | 'fitToData'
      | 'onVehicleClick'
    > = {
      create: vi.fn(async () => undefined),
      destroy: vi.fn(),
      setVehicles: vi.fn(),
      setSelected: vi.fn(),
      fitToData: vi.fn(),
      onVehicleClick: vi.fn(),
    };

    const store: Pick<
      VehicleStore,
      | 'start'
      | 'vehicles'
      | 'selected'
      | 'select'
      | 'lastUpdated'
      | 'selectionLost'
      | 'clearSelection'
      | 'status'
      | 'error'
      | 'refresh'
    > = {
      start,
      vehicles: signal<readonly Vehicle[]>([]).asReadonly(),
      selected: selected.asReadonly(),
      select: vi.fn(),
      lastUpdated: lastUpdated.asReadonly(),
      selectionLost: selectionLost.asReadonly(),
      clearSelection: vi.fn(),
      status: status.asReadonly(),
      error: error.asReadonly(),
      refresh,
    };

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: VehicleStore, useValue: store },
        { provide: MapLibreService, useValue: maplibre },
        { provide: NOW, useValue: () => NOW_MS },
      ],
    }).compileComponents();
  });

  async function render(): Promise<ComponentFixture<App>> {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  /** The one state the banner exists for: data on screen, feed failing. */
  async function goStale(fixture: ComponentFixture<App>): Promise<void> {
    status.set('loaded');
    lastUpdated.set(NOW_MS - 300_000);
    error.set(POLL_ERROR);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('starts the vehicle stream once', () => {
    TestBed.createComponent(App);

    expect(start).toHaveBeenCalledTimes(1);
  });

  it('renders the map', async () => {
    const fixture = await render();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-map')).not.toBeNull();
  });

  it('renders the sidebar alongside the map', async () => {
    const fixture = await render();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-vehicle-sidebar')).not.toBeNull();
  });

  it('shows no banner while the feed is healthy', async () => {
    const fixture = await render();
    status.set('loaded');
    lastUpdated.set(NOW_MS);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-feed-status-banner')).toBeNull();
  });

  it('shows no banner for an error that arrived before any data', async () => {
    const fixture = await render();
    status.set('error');
    error.set(POLL_ERROR);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-feed-status-banner')).toBeNull();
  });

  it('shows the banner with the age of the data when the feed goes stale', async () => {
    const fixture = await render();

    await goStale(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-feed-status-banner')).not.toBeNull();
    expect(host.textContent).toContain('5 min ago');
    expect(host.textContent).toContain('not responding');
  });

  it('keeps the map and the sidebar under the banner', async () => {
    const fixture = await render();

    await goStale(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-map')).not.toBeNull();
    expect(host.querySelector('app-vehicle-sidebar')).not.toBeNull();
  });

  it('refreshes the feed from the banner', async () => {
    const fixture = await render();
    await goStale(fixture);

    const host = fixture.nativeElement as HTMLElement;
    host
      .querySelector<HTMLButtonElement>('app-feed-status-banner button')
      ?.click();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  describe('the mobile drawer', () => {
    const toggle = (fixture: ComponentFixture<App>) =>
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
        '.drawer-toggle'
      );

    const drawer = (fixture: ComponentFixture<App>) =>
      (fixture.nativeElement as HTMLElement).querySelector(
        'app-vehicle-sidebar'
      );

    const pressEscape = async (fixture: ComponentFixture<App>) => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };

    it('starts closed', async () => {
      const fixture = await render();

      expect(drawer(fixture)?.classList.contains('open')).toBe(false);
      expect(toggle(fixture)?.getAttribute('aria-expanded')).toBe('false');
    });

    it('opens from the toggle', async () => {
      const fixture = await render();

      toggle(fixture)?.click();
      fixture.detectChanges();

      expect(drawer(fixture)?.classList.contains('open')).toBe(true);
      expect(toggle(fixture)?.getAttribute('aria-expanded')).toBe('true');
    });

    it('carries the vehicle count on the toggle', async () => {
      const fixture = await render();

      expect(toggle(fixture)?.textContent).toContain('View list (0)');
    });

    it('closes when the sidebar asks to be dismissed', async () => {
      const fixture = await render();
      toggle(fixture)?.click();
      fixture.detectChanges();

      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLButtonElement>('app-vehicle-sidebar .dismiss')
        ?.click();
      fixture.detectChanges();

      expect(drawer(fixture)?.classList.contains('open')).toBe(false);
    });

    it('closes on Escape', async () => {
      const fixture = await render();
      toggle(fixture)?.click();
      fixture.detectChanges();

      await pressEscape(fixture);

      expect(drawer(fixture)?.classList.contains('open')).toBe(false);
    });

    it('leaves Escape to the detail panel while a selection is open', async () => {
      const fixture = await render();
      toggle(fixture)?.click();
      fixture.detectChanges();
      selected.set({
        id: 'a',
        coordinates: { lat: 40.7, lon: -73.8 },
        status: 'available',
        isReserved: false,
        isDisabled: false,
      });

      await pressEscape(fixture);

      expect(drawer(fixture)?.classList.contains('open')).toBe(true);
    });

    it('leaves Escape to the panel while the selection is lost too', async () => {
      const fixture = await render();
      toggle(fixture)?.click();
      fixture.detectChanges();
      selectionLost.set(true);

      await pressEscape(fixture);

      expect(drawer(fixture)?.classList.contains('open')).toBe(true);
    });

    it('never unmounts the map', async () => {
      const fixture = await render();
      const host = fixture.nativeElement as HTMLElement;
      const before = host.querySelector('app-map');

      toggle(fixture)?.click();
      fixture.detectChanges();

      expect(host.querySelector('app-map')).toBe(before);
    });
  });
});
