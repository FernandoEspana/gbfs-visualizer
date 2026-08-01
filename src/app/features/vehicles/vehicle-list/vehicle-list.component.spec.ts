import { CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { Vehicle } from '../../../core/models/vehicle.model';
import { NOW } from '../../../core/time/now';
import { VehicleListComponent } from './vehicle-list.component';

const NOW_MS = 1_700_000_000_000;
const VIEWPORT_HEIGHT_PX = 640;

function vehicle(id: string, overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id,
    coordinates: { lat: 40.7, lon: -73.8 },
    status: 'available',
    isReserved: false,
    isDisabled: false,
    currentRangeMeters: 12_000,
    lastReported: NOW_MS - 120_000,
    ...overrides,
  };
}

function fleet(size: number): Vehicle[] {
  return Array.from({ length: size }, (_, i) => vehicle(`v-${i}`));
}

/**
 * jsdom performs no layout, so the viewport measures itself as zero high and
 * renders nothing. `clientHeight` is what the CDK reads, and handing it one is
 * what makes the rows exist at all.
 */
function stubHeight(element: HTMLElement): void {
  Object.defineProperty(element, 'clientHeight', {
    get: () => VIEWPORT_HEIGHT_PX,
  });
}

async function setup(vehicles: readonly Vehicle[]) {
  await TestBed.configureTestingModule({
    imports: [VehicleListComponent],
    providers: [{ provide: NOW, useValue: () => NOW_MS }],
  }).compileComponents();

  const fixture: ComponentFixture<VehicleListComponent> =
    TestBed.createComponent(VehicleListComponent);
  fixture.componentRef.setInput('vehicles', vehicles);
  fixture.detectChanges();

  const debugViewport = fixture.debugElement.query(
    By.directive(CdkVirtualScrollViewport)
  );
  const viewport = debugViewport.injector.get(CdkVirtualScrollViewport);
  stubHeight(debugViewport.nativeElement as HTMLElement);
  viewport.checkViewportSize();

  /**
   * The viewport defers its render over a microtask, whose effect only runs on
   * the next change detection pass, and the rows are instantiated on the pass
   * after that. Two rounds is what it takes; one leaves an empty viewport.
   */
  const flush = async () => {
    for (let round = 0; round < 2; round++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };

  await flush();

  // Stubbed, not just observed: both calls end in `Element.scrollTo`, which
  // jsdom does not implement.
  const scrollToIndex = vi
    .spyOn(viewport, 'scrollToIndex')
    .mockImplementation(() => undefined);
  const scrollToOffset = vi
    .spyOn(viewport, 'scrollToOffset')
    .mockImplementation(() => undefined);
  const host = fixture.nativeElement as HTMLElement;
  const listbox = debugViewport.nativeElement as HTMLElement;

  const selectFromElsewhere = async (selected: Vehicle | undefined) => {
    fixture.componentRef.setInput('selected', selected);
    fixture.detectChanges();
    await flush();
  };

  const press = async (key: string) => {
    listbox.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await flush();
  };

  const rows = () =>
    Array.from(host.querySelectorAll<HTMLElement>('[role="option"]'));

  const activeDescendant = () => listbox.getAttribute('aria-activedescendant');

  return {
    fixture,
    host,
    listbox,
    rows,
    press,
    activeDescendant,
    scrollToIndex,
    scrollToOffset,
    selectFromElsewhere,
  };
}

describe('VehicleListComponent', () => {
  it('emits the id of a clicked row', async () => {
    const { fixture, rows } = await setup(fleet(50));
    const emitted: string[] = [];
    fixture.componentInstance.select.subscribe(id => emitted.push(id));

    rows()[2].click();

    expect(emitted).toEqual(['v-2']);
  });

  it('scrolls to a selection that came from outside the list', async () => {
    const vehicles = fleet(50);
    const { scrollToIndex, selectFromElsewhere } = await setup(vehicles);

    await selectFromElsewhere(vehicles[37]);

    expect(scrollToIndex).toHaveBeenCalledWith(37, 'smooth');
  });

  it('does not scroll for a selection the list emitted itself', async () => {
    const vehicles = fleet(50);
    const { fixture, rows, scrollToIndex, selectFromElsewhere } =
      await setup(vehicles);

    // The click is the whole point: the store answers with the same vehicle,
    // which arrives back as an input.
    rows()[3].click();
    await selectFromElsewhere(vehicles[3]);

    expect(scrollToIndex).not.toHaveBeenCalled();
    expect(fixture.componentInstance.selected()?.id).toBe('v-3');
  });

  it('does not re-scroll when a tick replaces the selected vehicle object', async () => {
    const vehicles = fleet(50);
    const { scrollToIndex, selectFromElsewhere } = await setup(vehicles);
    await selectFromElsewhere(vehicles[10]);
    scrollToIndex.mockClear();

    // Same id, new object: what `store.selected()` returns on every tick.
    await selectFromElsewhere(vehicle('v-10'));

    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it('marks exactly one row as selected', async () => {
    const vehicles = fleet(50);
    const { rows, selectFromElsewhere } = await setup(vehicles);

    await selectFromElsewhere(vehicles[4]);

    const selected = rows().filter(
      row => row.getAttribute('aria-selected') === 'true'
    );
    expect(selected).toHaveLength(1);
    expect(selected[0].id).toBe('vehicle-option-v-4');
  });

  it('renders only a window of rows, not one node per vehicle', async () => {
    const { rows } = await setup(fleet(3_362));

    expect(rows().length).toBeGreaterThan(0);
    expect(rows().length).toBeLessThan(100);
  });

  it('sizes every row against the whole fleet, not the rendered window', async () => {
    const { rows } = await setup(fleet(3_362));

    for (const row of rows()) {
      expect(row.getAttribute('aria-setsize')).toBe('3362');
    }
    expect(rows()[0].getAttribute('aria-posinset')).toBe('1');
  });

  it('is a single tab stop, whatever the fleet size', async () => {
    const { host, listbox } = await setup(fleet(3_362));

    expect(listbox.getAttribute('tabindex')).toBe('0');
    expect(host.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(host.querySelectorAll('[role="option"][tabindex]')).toHaveLength(0);
  });

  it('moves the active row with the arrow keys without selecting', async () => {
    const { fixture, press, activeDescendant } = await setup(fleet(50));
    const emitted: string[] = [];
    fixture.componentInstance.select.subscribe(id => emitted.push(id));

    await press('ArrowDown');
    await press('ArrowDown');
    expect(activeDescendant()).toBe('vehicle-option-v-2');

    await press('ArrowUp');
    expect(activeDescendant()).toBe('vehicle-option-v-1');
    expect(emitted).toEqual([]);
  });

  it('stops at the ends instead of wrapping', async () => {
    const { press, activeDescendant } = await setup(fleet(3));

    await press('ArrowUp');
    expect(activeDescendant()).toBe('vehicle-option-v-0');

    await press('End');
    await press('ArrowDown');
    expect(activeDescendant()).toBe('vehicle-option-v-2');
  });

  it('reaches the ends of the whole fleet, not of the rendered window', async () => {
    const { press, activeDescendant } = await setup(fleet(3_362));

    await press('End');
    expect(activeDescendant()).toBe('vehicle-option-v-3361');

    await press('Home');
    expect(activeDescendant()).toBe('vehicle-option-v-0');
  });

  it('selects the active row with Enter and with Space', async () => {
    const { fixture, press } = await setup(fleet(50));
    const emitted: string[] = [];
    fixture.componentInstance.select.subscribe(id => emitted.push(id));

    await press('ArrowDown');
    await press('Enter');
    await press('ArrowDown');
    await press(' ');

    expect(emitted).toEqual(['v-1', 'v-2']);
  });

  it('scrolls the active row back into view rather than to the top', async () => {
    const { press, scrollToOffset } = await setup(fleet(3_362));

    // Ten rows fit in 640px, so the tenth move is the first that has to scroll.
    for (let i = 0; i < 9; i++) {
      await press('ArrowDown');
    }
    expect(scrollToOffset).not.toHaveBeenCalled();

    await press('ArrowDown');
    expect(scrollToOffset).toHaveBeenCalledWith(64 * 11 - 640);
  });

  it('names an element that is actually in the DOM', async () => {
    const { host, press, activeDescendant } = await setup(fleet(3_362));

    await press('ArrowDown');

    const id = activeDescendant();
    expect(id).not.toBeNull();
    expect(host.querySelector(`#${id}`)).not.toBeNull();
  });

  it('points at nothing when there are no vehicles', async () => {
    const { activeDescendant } = await setup([]);

    expect(activeDescendant()).toBeNull();
  });

  it('moves the keyboard cursor onto a selection made elsewhere', async () => {
    const vehicles = fleet(50);
    const { activeDescendant, selectFromElsewhere } = await setup(vehicles);

    await selectFromElsewhere(vehicles[20]);

    expect(activeDescendant()).toBe('vehicle-option-v-20');
  });

  it('keeps the scroll wrapper out of the accessibility tree', async () => {
    const { host } = await setup(fleet(50));

    const wrapper = host.querySelector('.cdk-virtual-scroll-content-wrapper');
    expect(wrapper?.getAttribute('role')).toBe('presentation');
  });
});
