import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import type { Observable } from 'rxjs';
import { GBFS_FEED_URL } from './gbfs-feed-url';

/**
 * Transport only. Retry, timeout and translation live in the layers above, so
 * swapping provider or GBFS version touches this file and `GbfsMapper`, nothing
 * else.
 */
@Service()
export class GbfsApi {
  readonly #http = inject(HttpClient);
  readonly #url = inject(GBFS_FEED_URL);

  /**
   * `unknown` rather than a raw feed type: the generic on `get` is a cast, not a
   * check, and the payload comes from a third party. `GbfsMapper` is what turns
   * it into something knowable.
   */
  fetchVehicleStatus(): Observable<unknown> {
    return this.#http.get<unknown>(this.#url);
  }
}
