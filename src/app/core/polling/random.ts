import { InjectionToken } from '@angular/core';

/** Seam so backoff jitter is exact under test. Stub it with `() => 0.5`. */
export const RANDOM = new InjectionToken<() => number>('RANDOM', {
  providedIn: 'root',
  factory: () => Math.random,
});
