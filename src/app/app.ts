import { Component, computed, inject, signal } from '@angular/core';
import { MapComponent } from './features/map/map/map.component';
import { FeedStatusBannerComponent } from './features/shell/feed-status-banner/feed-status-banner.component';
import { VehicleSidebarComponent } from './features/vehicles/vehicle-sidebar/vehicle-sidebar.component';
import { VehicleStore } from './core/state/vehicle-store/vehicle-store';

@Component({
  selector: 'app-root',
  imports: [MapComponent, VehicleSidebarComponent, FeedStatusBannerComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class App {
  protected readonly store = inject(VehicleStore);

  /** Mobile only; above the breakpoint the sidebar is always on screen. */
  readonly #drawerOpen = signal(false);
  protected readonly drawerOpen = this.#drawerOpen.asReadonly();

  /**
   * An error with data already on screen is a banner, not a state swap: the
   * store keeps the last snapshot on failure precisely so stale data beats a
   * blank map. Null whenever there is nothing stale to report.
   */
  protected readonly staleFeed = computed(() => {
    const error = this.store.error();
    const lastUpdated = this.store.lastUpdated();

    return this.store.status() === 'loaded' &&
      error !== null &&
      lastUpdated !== null
      ? { error, lastUpdated }
      : null;
  });

  constructor() {
    this.store.start();
  }

  protected openDrawer(): void {
    this.#drawerOpen.set(true);
  }

  protected closeDrawer(): void {
    this.#drawerOpen.set(false);
  }

  /**
   * Precedence, not propagation: two document listeners on the same target
   * cannot be ordered reliably, so the drawer simply declines the key while a
   * detail panel is open and lets the panel have it.
   */
  protected onEscape(): void {
    const panelOpen =
      this.store.selected() !== undefined || this.store.selectionLost();
    if (panelOpen) {
      return;
    }

    this.closeDrawer();
  }
}
