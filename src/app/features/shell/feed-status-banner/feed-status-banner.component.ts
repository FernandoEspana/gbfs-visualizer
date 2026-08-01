import { Component, inject, input, output } from '@angular/core';
import { formatRelativeTime } from '../../../core/format/vehicle-format';
import type { PollError } from '../../../core/polling/poll-result';
import { NOW } from '../../../core/time/now';

const REASONS: Record<PollError['kind'], string> = {
  network: 'The feed is not responding',
  http: 'The feed answered with an error',
  schema: 'The feed answered with data this app cannot read',
};

/**
 * Stale data over a live map. It exists because the store keeps the last
 * snapshot on failure: without a banner, the map would go on showing minute-old
 * scooters with nothing saying so.
 */
@Component({
  selector: 'app-feed-status-banner',
  templateUrl: './feed-status-banner.component.html',
  styleUrl: './feed-status-banner.component.css',
  host: {
    role: 'status',
  },
})
export class FeedStatusBannerComponent {
  readonly error = input.required<PollError>();
  readonly lastUpdated = input.required<number>();
  readonly retry = output<void>();

  readonly #now = inject(NOW);

  protected reason(): string {
    return REASONS[this.error().kind];
  }

  protected age(): string {
    return formatRelativeTime(this.lastUpdated(), this.#now());
  }
}
