import { DOCUMENT } from '@angular/common';
import { provideHttpClient, withFetch } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { GBFS_FEED_URL } from './core/gbfs/gbfs-feed-url';
import { routes } from './app.routes';

/** Rewritten to the Lime feed by `proxy.conf.json`; the feed sends no CORS header. */
const DEV_FEED_URL = '/api/gbfs/free_bike_status.json';

/**
 * The GitHub Pages demo is static: no proxy, and the feed sends no CORS header,
 * so production replays a captured snapshot instead. Resolved against
 * `baseURI` because the site is served from a repository subpath.
 */
const PROD_FEED_PATH = 'gbfs/free_bike_status.json';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    {
      provide: GBFS_FEED_URL,
      useFactory: () =>
        isDevMode()
          ? DEV_FEED_URL
          : new URL(PROD_FEED_PATH, inject(DOCUMENT).baseURI).toString(),
    },
  ],
};
