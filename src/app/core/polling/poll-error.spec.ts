import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError } from 'rxjs';
import { GbfsMapperError } from '../gbfs/gbfs-mapper';
import { toPollError } from './poll-error';

const NOW = 1785363766000;

describe('toPollError', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('classifies a status 0 response as a network fault', () => {
    const error = toPollError(
      new HttpErrorResponse({ status: 0, url: '/api/gbfs' }),
      4
    );

    expect(error.kind).toBe('network');
    expect(error.status).toBeUndefined();
  });

  it('classifies a 503 as an http fault and keeps the status', () => {
    const error = toPollError(
      new HttpErrorResponse({ status: 503, statusText: 'Service Unavailable' }),
      4
    );

    expect(error.kind).toBe('http');
    expect(error.status).toBe(503);
  });

  it('classifies a timeout as a network fault', () => {
    const error = toPollError(new TimeoutError(), 1);

    expect(error.kind).toBe('network');
    expect(error.message).toContain('did not respond');
  });

  it('classifies a mapper failure as a schema fault and keeps its message', () => {
    const error = toPollError(new GbfsMapperError('no data envelope'), 1);

    expect(error.kind).toBe('schema');
    expect(error.message).toBe('no data envelope');
    expect(error.status).toBeUndefined();
  });

  it('falls back to a network fault with a generic message', () => {
    const error = toPollError('something threw a string', 1);

    expect(error.kind).toBe('network');
    expect(error.message).toBe('The feed could not be reached.');
  });

  it('records the attempts spent and the wall-clock time', () => {
    const error = toPollError(new HttpErrorResponse({ status: 500 }), 4);

    expect(error.attempts).toBe(4);
    expect(error.at).toBe(NOW);
  });
});
