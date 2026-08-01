import {
  Component,
  computed,
  effect,
  inject,
  output,
  signal,
} from '@angular/core';
import { formatRelativeTime } from '../../../core/format/vehicle-format';
import type { Vehicle } from '../../../core/models/vehicle.model';
import { VehicleStore } from '../../../core/state/vehicle-store/vehicle-store';
import { NOW } from '../../../core/time/now';
import { VehicleDetailPanelComponent } from '../vehicle-detail-panel/vehicle-detail-panel.component';
import { VehicleListComponent } from '../vehicle-list/vehicle-list.component';

/**
 * The only component wired to the store. It reads signals and calls methods;
 * everything below it takes inputs and emits intent.
 */
@Component({
  selector: 'app-vehicle-sidebar',
  imports: [VehicleListComponent, VehicleDetailPanelComponent],
  templateUrl: './vehicle-sidebar.component.html',
  styleUrl: './vehicle-sidebar.component.css',
  host: {
    role: 'complementary',
    'aria-label': 'Vehicle list',
  },
})
export class VehicleSidebarComponent {
  /** Asks the shell to close the drawer. Only ever acted on below 768px. */
  readonly dismiss = output<void>();

  protected readonly store = inject(VehicleStore);

  readonly #now = inject(NOW);

  /**
   * The store resolves `selected()` against the live snapshot, so a vehicle
   * that drops out of the feed leaves nothing to render. Remembering the last
   * one is what lets the panel say which vehicle was lost instead of vanishing.
   */
  readonly #lastSelected = signal<Vehicle | undefined>(undefined);

  protected readonly panelVehicle = computed(
    () =>
      this.store.selected() ??
      (this.store.selectionLost() ? this.#lastSelected() : undefined)
  );

  /** Placeholder rows. The count is cosmetic: enough to fill a first screen. */
  protected readonly skeletonRows = [1, 2, 3, 4, 5, 6, 7, 8];

  protected readonly countLabel = computed(() => {
    const count = this.store.vehicles().length;
    return `${count} ${count === 1 ? 'vehicle' : 'vehicles'}`;
  });

  protected readonly updatedLabel = computed(() => {
    const lastUpdated = this.store.lastUpdated();
    return lastUpdated === null
      ? 'not updated yet'
      : `updated ${formatRelativeTime(lastUpdated, this.#now())}`;
  });

  constructor() {
    effect(() => {
      const selected = this.store.selected();
      if (selected !== undefined) {
        this.#lastSelected.set(selected);
      }
    });
  }
}
