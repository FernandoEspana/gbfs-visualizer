import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MapLibreService } from '../../core/map/maplibre.service';
import type { VehicleCollection } from '../../core/map/vehicle-geojson';
import type { Vehicle } from '../../core/models/vehicle.model';
import { VehicleStore } from '../../core/state/vehicle-store';
import { MapComponent } from './map.component';

/**
 * Records call sequences. The real service is never constructed in a test:
 * its dynamic import would need WebGL, which jsdom does not have.
 */
class MapLibreServiceDouble {
  createCalls = 0;
  destroyCalls = 0;
  readonly collections: VehicleCollection[] = [];
  readonly fits: VehicleCollection[] = [];
  readonly selections: (string | null)[] = [];

  #click: ((id: string) => void) | null = null;

  async create(): Promise<void> {
    this.createCalls++;
  }

  setVehicles(collection: VehicleCollection): void {
    this.collections.push(collection);
  }

  fitToData(collection: VehicleCollection): void {
    this.fits.push(collection);
  }

  setSelected(id: string | null): void {
    this.selections.push(id);
  }

  onVehicleClick(handler: (id: string) => void): void {
    this.#click = handler;
  }

  destroy(): void {
    this.destroyCalls++;
  }

  /** Stands in for a click on a rendered feature. */
  emitClick(id: string): void {
    this.#click?.(id);
  }
}

function vehicle(id: string): Vehicle {
  return {
    id,
    coordinates: { lat: 40.7, lon: -73.8 },
    status: 'available',
    isReserved: false,
    isDisabled: false,
    currentRangeMeters: 12_000,
  };
}

function ids(collection: VehicleCollection): string[] {
  return collection.features.map(feature => feature.properties.id);
}

async function setup() {
  const maplibre = new MapLibreServiceDouble();
  const vehicles = signal<readonly Vehicle[]>([]);
  const selected = signal<Vehicle | undefined>(undefined);
  const select = vi.fn();

  const store: Pick<VehicleStore, 'vehicles' | 'selected' | 'select'> = {
    vehicles: vehicles.asReadonly(),
    selected: selected.asReadonly(),
    select,
  };

  await TestBed.configureTestingModule({
    imports: [MapComponent],
    providers: [
      { provide: MapLibreService, useValue: maplibre },
      { provide: VehicleStore, useValue: store },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(MapComponent);
  fixture.detectChanges();
  await fixture.whenStable();

  const tick = async (...vehicleIds: string[]) => {
    vehicles.set(vehicleIds.map(vehicle));
    fixture.detectChanges();
    await fixture.whenStable();
  };

  const selectFromElsewhere = async (v: Vehicle | undefined) => {
    selected.set(v);
    fixture.detectChanges();
    await fixture.whenStable();
  };

  return { fixture, maplibre, select, tick, selectFromElsewhere };
}

describe('MapComponent', () => {
  it('creates the map once, however many snapshots arrive', async () => {
    const { maplibre, tick } = await setup();

    await tick('a');
    await tick('b');
    await tick('c');

    expect(maplibre.createCalls).toBe(1);
  });

  it('pushes exactly one collection per tick', async () => {
    const { maplibre, tick } = await setup();
    const before = maplibre.collections.length;

    await tick('a');
    await tick('a', 'b');
    await tick('a', 'b', 'c');

    expect(maplibre.collections.length - before).toBe(3);
    expect(maplibre.collections.slice(-3).map(ids)).toEqual([
      ['a'],
      ['a', 'b'],
      ['a', 'b', 'c'],
    ]);
  });

  it('renders a snapshot that landed while the map was still loading', async () => {
    const { maplibre } = await setup();

    // `create` resolves before any tick, so the only way the collection can
    // reach the map is the push the component makes on resolution.
    expect(maplibre.collections.length).toBeGreaterThan(0);
  });

  it('selects the clicked vehicle', async () => {
    const { maplibre, select, tick } = await setup();
    await tick('a', 'b');

    maplibre.emitClick('b');

    expect(select).toHaveBeenCalledWith('b');
  });

  it('moves the highlight without touching the source', async () => {
    const { maplibre, tick, selectFromElsewhere } = await setup();
    await tick('a', 'b');
    const collectionsBefore = maplibre.collections.length;

    await selectFromElsewhere(vehicle('b'));

    expect(maplibre.selections.at(-1)).toBe('b');
    expect(maplibre.collections.length).toBe(collectionsBefore);
  });

  it('clears the highlight when the selection goes away', async () => {
    const { maplibre, tick, selectFromElsewhere } = await setup();
    await tick('a');
    await selectFromElsewhere(vehicle('a'));

    await selectFromElsewhere(undefined);

    expect(maplibre.selections.at(-1)).toBeNull();
  });

  it('fits the camera to the first non-empty snapshot only', async () => {
    const { maplibre, tick } = await setup();

    await tick();
    expect(maplibre.fits).toHaveLength(0);

    await tick('a', 'b');
    await tick('a', 'b', 'c');

    expect(maplibre.fits.map(ids)).toEqual([['a', 'b']]);
  });

  it('destroys the map on teardown', async () => {
    const { fixture, maplibre } = await setup();

    fixture.destroy();

    expect(maplibre.destroyCalls).toBe(1);
  });
});
