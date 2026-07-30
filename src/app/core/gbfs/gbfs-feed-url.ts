import { InjectionToken } from '@angular/core';

/**
 * Absolute or app-relative URL of the free-floating vehicle feed.
 *
 * Deliberately has no factory: the dev value goes through the `ng serve` proxy
 * and only works on localhost, so a missing provider must fail at injection
 * rather than silently point a production build at a path that 404s.
 */
export const GBFS_FEED_URL = new InjectionToken<string>('GBFS_FEED_URL');
