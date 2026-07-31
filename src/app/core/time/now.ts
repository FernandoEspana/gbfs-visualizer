import { InjectionToken } from '@angular/core';

/** Seam so relative times are exact under test. Stub it with `() => 1_700_000_000_000`. */
export const NOW = new InjectionToken<() => number>('NOW', {
  providedIn: 'root',
  factory: () => Date.now,
});
