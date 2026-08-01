import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { GbfsApi } from './gbfs-api';
import { GBFS_FEED_URL } from '../gbfs-feed-url';
import limeFeed from '../__fixtures__/lime-free-bike-status.json';

const FEED_URL = '/api/gbfs/free_bike_status.json';

describe('GbfsApi', () => {
  let api: GbfsApi;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: GBFS_FEED_URL, useValue: FEED_URL },
      ],
    });
    api = TestBed.inject(GbfsApi);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('issues one GET to the injected feed url', () => {
    api.fetchVehicleStatus().subscribe();

    const request = httpMock.expectOne(FEED_URL);
    expect(request.request.method).toBe('GET');
    request.flush(limeFeed);
  });

  it('passes the response body through untouched', () => {
    let received: unknown;
    api.fetchVehicleStatus().subscribe(body => (received = body));

    httpMock.expectOne(FEED_URL).flush(limeFeed);

    expect(received).toEqual(limeFeed);
  });

  it('propagates an http failure as an error notification', () => {
    let caught: unknown;
    api.fetchVehicleStatus().subscribe({ error: error => (caught = error) });

    httpMock
      .expectOne(FEED_URL)
      .flush('down', { status: 503, statusText: 'Service Unavailable' });

    expect(caught).toBeInstanceOf(HttpErrorResponse);
    expect((caught as HttpErrorResponse).status).toBe(503);
  });

  it('fails at injection when no feed url is provided', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    expect(() => TestBed.inject(GbfsApi)).toThrow();
  });

  it('does not retry a failed request', () => {
    api.fetchVehicleStatus().subscribe({ error: () => undefined });

    httpMock
      .expectOne(FEED_URL)
      .flush('down', { status: 503, statusText: 'Service Unavailable' });

    httpMock.expectNone(FEED_URL);
  });
});
