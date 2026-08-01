import { TestBed } from '@angular/core/testing';
import type { Vehicle } from '@core/models/vehicle.model';
import { NOW } from '@core/time/now';
import { VehicleDetailPanelComponent } from './vehicle-detail-panel.component';

const NOW_MS = 1_700_000_000_000;

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'scooter-42',
    coordinates: { lat: 40.71234, lon: -73.85678 },
    status: 'available',
    isReserved: false,
    isDisabled: false,
    vehicleType: 'scooter',
    currentRangeMeters: 18_400,
    lastReported: NOW_MS - 120_000,
    ...overrides,
  };
}

async function setup(subject: Vehicle = vehicle(), lost = false) {
  await TestBed.configureTestingModule({
    imports: [VehicleDetailPanelComponent],
    providers: [{ provide: NOW, useValue: () => NOW_MS }],
  }).compileComponents();

  const fixture = TestBed.createComponent(VehicleDetailPanelComponent);
  fixture.componentRef.setInput('vehicle', subject);
  fixture.componentRef.setInput('lost', lost);
  fixture.detectChanges();
  await fixture.whenStable();

  const closes: number[] = [];
  fixture.componentInstance.close.subscribe(() => closes.push(1));

  const host = fixture.nativeElement as HTMLElement;

  const pressEscape = async () => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    fixture.detectChanges();
    await fixture.whenStable();
  };

  return { fixture, host, closes, pressEscape, text: () => host.textContent };
}

describe('VehicleDetailPanelComponent', () => {
  it('renders every field of the selected vehicle', async () => {
    const { text } = await setup();

    expect(text()).toContain('scooter-42');
    expect(text()).toContain('scooter');
    expect(text()).toContain('available');
    expect(text()).toContain('18.4 km');
    expect(text()).toContain('40.71234, -73.85678');
    expect(text()).toContain('2 min ago');
  });

  it('names a missing type and a missing range rather than inventing one', async () => {
    const { text } = await setup(
      vehicle({ vehicleType: undefined, currentRangeMeters: undefined })
    );

    expect(text()).toContain('unknown');
    expect(text()).toContain('no data');
  });

  it('paints the range dot the colour that vehicle has on the map', async () => {
    const { host } = await setup(vehicle({ currentRangeMeters: 2_000 }));

    const dot = host.querySelector<HTMLElement>('.dot');
    expect(dot?.style.backgroundColor).toBe('rgb(215, 25, 28)');
  });

  it('emits close once when the button is pressed', async () => {
    const { host, closes } = await setup();

    host.querySelector<HTMLButtonElement>('button')?.click();

    expect(closes).toHaveLength(1);
  });

  it('emits close once on Escape, wherever focus is', async () => {
    const { closes, pressEscape } = await setup();

    await pressEscape();

    expect(closes).toHaveLength(1);
  });

  it('swaps the fields for a notice when the feed has lost the vehicle', async () => {
    const { host, text } = await setup(vehicle(), true);

    expect(text()).toContain('no longer in the feed');
    expect(host.querySelector('dl')).toBeNull();
    expect(text()).toContain('scooter-42');
  });

  it('keeps a working close action while the vehicle is lost', async () => {
    const { host, closes, pressEscape } = await setup(vehicle(), true);

    host.querySelector<HTMLButtonElement>('button')?.click();
    await pressEscape();

    expect(closes).toHaveLength(2);
  });
});
