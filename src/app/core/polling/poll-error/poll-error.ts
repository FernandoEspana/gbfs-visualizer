import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError } from 'rxjs';
import { GbfsMapperError } from '@core/gbfs/gbfs-mapper/gbfs-mapper';
import type { PollError } from '../poll-result';

/**
 * Classifies whatever came out of a failed tick. `status === 0` is what a
 * browser reports for an offline, refused or CORS-rejected request, so it is a
 * network fault rather than an HTTP one despite arriving as an
 * `HttpErrorResponse`.
 */
export function toPollError(cause: unknown, attempts: number): PollError {
  const at = Date.now();

  if (cause instanceof GbfsMapperError) {
    return { kind: 'schema', message: cause.message, attempts, at };
  }

  if (cause instanceof TimeoutError) {
    return {
      kind: 'network',
      message: 'The feed did not respond in time.',
      attempts,
      at,
    };
  }

  if (cause instanceof HttpErrorResponse) {
    return cause.status === 0
      ? { kind: 'network', message: cause.message, attempts, at }
      : {
          kind: 'http',
          message: cause.message,
          status: cause.status,
          attempts,
          at,
        };
  }

  return {
    kind: 'network',
    message: 'The feed could not be reached.',
    attempts,
    at,
  };
}
