import { provideHttpClient, withFetch } from '@angular/common/http';
import {
  ApplicationConfig,
  isDevMode,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { GBFS_FEED_URL } from '@core/gbfs/gbfs-feed-url';
import { routes } from './app.routes';

/** Rewritten to the Lime feed by `proxy.conf.json`; the feed sends no CORS header. */
const DEV_FEED_URL = '/api/gbfs/free_bike_status.json';

/**
 * GitHub Pages is static and cannot proxy, so production reads the feed through
 * the Cloudflare Worker in `worker/`, which adds the missing CORS header. See
 * `worker/README.md` for deploy and rollback.
 */
const PROD_FEED_URL = 'https://gbfs-proxy.fernandoespana-dev.workers.dev/';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    {
      provide: GBFS_FEED_URL,
      useFactory: () => (isDevMode() ? DEV_FEED_URL : PROD_FEED_URL),
    },
  ],
};
