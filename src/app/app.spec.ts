import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { MapLibreService } from './core/map/maplibre.service';
import { VehicleStore } from './core/state/vehicle-store';

describe('App', () => {
  const start = vi.fn();

  beforeEach(async () => {
    start.mockClear();

    // Neither real collaborator may run here: the store reaches the network
    // the moment App is constructed, and the map needs WebGL.
    const maplibre: Pick<
      MapLibreService,
      'create' | 'destroy' | 'setVehicles'
    > = {
      create: vi.fn(async () => undefined),
      destroy: vi.fn(),
      setVehicles: vi.fn(),
    };

    const store: Pick<VehicleStore, 'start' | 'vehicles'> = {
      start,
      vehicles: signal([]).asReadonly(),
    };

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: VehicleStore, useValue: store },
        { provide: MapLibreService, useValue: maplibre },
      ],
    }).compileComponents();
  });

  it('starts the vehicle stream once', () => {
    TestBed.createComponent(App);

    expect(start).toHaveBeenCalledTimes(1);
  });

  it('renders the map', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-map')).not.toBeNull();
  });
});
