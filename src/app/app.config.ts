import { provideHttpClient, withFetch } from '@angular/common/http';
import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { GBFS_FEED_URL } from './core/gbfs/gbfs-feed-url';
import { routes } from './app.routes';

/** Rewritten to the Lime feed by `proxy.conf.json`; the feed sends no CORS header. */
const DEV_FEED_URL = '/api/gbfs/free_bike_status.json';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    { provide: GBFS_FEED_URL, useValue: DEV_FEED_URL },
  ],
};
