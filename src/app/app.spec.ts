import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { VehicleStore } from './core/state/vehicle-store';

describe('App', () => {
  beforeEach(async () => {
    // The real store would reach the network the moment App is constructed.
    const store: Pick<VehicleStore, 'start'> = { start: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: VehicleStore, useValue: store }],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain(
      'Hello, gbfs-visualizer'
    );
  });
});
