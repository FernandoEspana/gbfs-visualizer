import { Component } from '@angular/core';
import {
  RANGE_BUCKETS,
  UNKNOWN_RANGE_COLOR,
} from '../../../core/map/range-buckets/range-buckets';

/**
 * The key to the map's colours. It reads the same constant the paint spec is
 * generated from, so the two cannot drift apart.
 */
@Component({
  selector: 'app-map-legend',
  template: `
    <section class="legend" aria-labelledby="legend-title">
      <h2 class="title" id="legend-title">Battery range</h2>

      <ul class="entries">
        @for (bucket of buckets; track bucket.fromMeters) {
          <li>
            <span
              class="swatch"
              [style.background-color]="bucket.color"
              aria-hidden="true"></span>
            {{ bucket.label }}
          </li>
        }
        <li>
          <span
            class="swatch"
            [style.background-color]="unknownColor"
            aria-hidden="true"></span>
          Unknown
        </li>
      </ul>
    </section>
  `,
  styles: `
    .legend {
      position: absolute;
      inset-block-end: 1.5rem;
      inset-inline-start: 0.75rem;
      padding: 0.625rem 0.75rem;
      border-radius: 0.5rem;
      background-color: #ffffff;
      color: #111827;
      box-shadow: 0 1px 4px rgb(0 0 0 / 0.25);
      font-size: 0.75rem;
      line-height: 1.4;
    }

    .title {
      margin-block-end: 0.375rem;
      font-size: 0.6875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .entries {
      display: grid;
      gap: 0.25rem;
    }

    li {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      white-space: nowrap;
    }

    .swatch {
      inline-size: 0.75rem;
      block-size: 0.75rem;
      border-radius: 9999px;
      /* The halo colour of the selection layer, at low alpha: the swatch has
         to stay visible against a white card. */
      box-shadow: inset 0 0 0 1px rgb(17 24 39 / 0.2);
    }
  `,
})
export class MapLegendComponent {
  protected readonly buckets = RANGE_BUCKETS;
  protected readonly unknownColor = UNKNOWN_RANGE_COLOR;
}
