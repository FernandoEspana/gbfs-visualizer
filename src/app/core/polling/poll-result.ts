import type { VehicleSnapshot } from '../models/vehicle.model';

/**
 * `network` covers anything with no usable status: an offline browser, a
 * refused connection, a CORS rejection, a request that timed out.
 */
export type PollErrorKind = 'network' | 'http' | 'schema';

export interface PollError {
  kind: PollErrorKind;
  message: string;
  status?: number; // HTTP status; only set when kind is 'http'
  attempts: number; // attempts spent before giving up
  at: number; // epoch milliseconds
}

/**
 * The failure travels as a value, not as an error notification: an observable
 * that errors would end the polling at the moment retrying matters most.
 */
export type PollResult =
  | { kind: 'success'; snapshot: VehicleSnapshot }
  | { kind: 'error'; error: PollError };
