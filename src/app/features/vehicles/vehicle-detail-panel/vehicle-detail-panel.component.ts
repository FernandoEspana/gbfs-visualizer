import { Component, inject, input, output } from '@angular/core';
import {
  formatCoordinates,
  formatRange,
  formatRelativeTime,
} from '../../../core/format/vehicle-format';
import {
  bucketFor,
  UNKNOWN_RANGE_COLOR,
} from '../../../core/map/range-buckets/range-buckets';
import type { Vehicle } from '../../../core/models/vehicle.model';
import { NOW } from '../../../core/time/now';

/**
 * The selected vehicle, in full. Presentational: it is told which vehicle to
 * render and whether the feed has lost it, and it emits one intent.
 */
@Component({
  selector: 'app-vehicle-detail-panel',
  templateUrl: './vehicle-detail-panel.component.html',
  styleUrl: './vehicle-detail-panel.component.css',
  host: {
    // Document-level: the key has to work wherever focus is — the map canvas,
    // the list, or the panel itself.
    '(document:keydown.escape)': 'close.emit()',
  },
})
export class VehicleDetailPanelComponent {
  readonly vehicle = input.required<Vehicle>();
  /** `store.selectionLost()`: the vehicle is gone from the feed, not deselected. */
  readonly lost = input(false);
  // Named for the domain, not for the DOM. The native `close` event belongs to
  // `<dialog>`, which this panel is not.
  // eslint-disable-next-line @angular-eslint/no-output-native
  readonly close = output<void>();

  readonly #now = inject(NOW);

  protected dotColor(): string {
    return (
      bucketFor(this.vehicle().currentRangeMeters)?.color ?? UNKNOWN_RANGE_COLOR
    );
  }

  protected range(): string {
    return formatRange(this.vehicle().currentRangeMeters);
  }

  protected coordinates(): string {
    return formatCoordinates(this.vehicle().coordinates);
  }

  protected reportedAt(): string {
    const reported = this.vehicle().lastReported;
    return reported === undefined
      ? 'no data'
      : formatRelativeTime(reported, this.#now());
  }
}
