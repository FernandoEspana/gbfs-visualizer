# SPEC 02 — GBFS data fetching and polling

> **Status:** Implemented
> **Depends on:** SPEC 01
> **Date:** 2026-07-30
> **Objective:** Add `GbfsApi` for the raw HTTP fetch and `VehiclePolling` for a `ttl`-aligned stream of `VehicleSnapshot` results that retries with exponential backoff and never dies, so the app has live data flowing before anything renders it.

## Scope

**In:**

- `GbfsApi`, a `@Service` singleton in `src/app/core/gbfs/gbfs-api.ts`, exposing one method that returns `Observable<unknown>`. HTTP only: no domain types, no mapper, no retry.
- The `GBFS_FEED_URL` injection token in `src/app/core/gbfs/gbfs-feed-url.ts`, provided in `app.config.ts` with the dev-proxy path `/api/gbfs/free_bike_status.json`.
- `provideHttpClient(withFetch())` added to `app.config.ts`.
- `VehiclePolling`, a `@Service` singleton in `src/app/core/polling/vehicle-polling.ts`, exposing a cold `Observable<PollResult>` that never errors and never completes.
- The `PollResult` discriminated union and the `PollError` shape, in `src/app/core/polling/poll-result.ts`.
- A per-request `timeout(15_000)`, classified as `kind: 'network'`.
- Retry with exponential backoff: 3 attempts, `1s → 2s → 4s`, capped at `30s`, ±20% jitter. The attempt counter resets on every successful tick.
- `GbfsMapperError` bypasses retry and emits `kind: 'schema'` immediately.
- A dynamic interval: the first tick fires immediately, and each subsequent delay is read from the last successful snapshot's `ttlMs`. After an error the delay falls back to the last known good `ttlMs`.
- The `RANDOM` injection token in `src/app/core/polling/random.ts`, defaulting to `Math.random`, so backoff jitter is deterministic under test.
- Unit tests in `src/app/core/polling/vehicle-polling.spec.ts` using `provideHttpClientTesting` and `vi.useFakeTimers()`, covering retry, backoff timing, cancellation, error classification and interval alignment.
- Correcting the layer diagram and service names in `README.md` (`GbfsApi`, `VehiclePolling`).

**Out of scope (for future specs):**

- `VehicleStore`, signals, `computed()` derived state, and the `loading → loaded → empty → error` transitions.
- Deciding at what `droppedCount` a degraded feed becomes a user-visible error. SPEC 01 deferred it to the store; it stays there.
- A `refresh()` method for a manual, out-of-band tick. SPEC 03 adds it when the error state needs a retry button.
- Pausing the stream while the tab is hidden (`visibilitychange`).
- Caching, deduplication, or serving a stale snapshot while a retry is in flight.
- The production deployment story for the missing proxy. It stays a documented limitation in `README.md`.
- Any component, template, map or `maplibre-gl` code.

## Data model

### Poll result — `src/app/core/polling/poll-result.ts`

```typescript
export type PollErrorKind = 'network' | 'http' | 'schema';

export interface PollError {
  kind: PollErrorKind;
  message: string;
  status?: number; // HTTP status; only set when kind is 'http'
  attempts: number; // attempts spent before giving up
  at: number; // epoch milliseconds
}

export type PollResult =
  | { kind: 'success'; snapshot: VehicleSnapshot }
  | { kind: 'error'; error: PollError };
```

### Tokens

```typescript
// src/app/core/gbfs/gbfs-feed-url.ts
export const GBFS_FEED_URL = new InjectionToken<string>('GBFS_FEED_URL');

// src/app/core/polling/random.ts — seam so backoff jitter is deterministic under test
export const RANDOM = new InjectionToken<() => number>('RANDOM', {
  providedIn: 'root',
  factory: () => Math.random,
});
```

`GBFS_FEED_URL` has no factory: it is provided in `app.config.ts`, so a missing
provider fails loudly at injection instead of silently defaulting to a URL that
only works in dev.

### Backoff

```
delay(attempt) = min(1000 * 2^attempt, 30_000) * (0.8 + 0.4 * random())
```

`attempt` is zero-based, so the three retry delays are drawn from `1s`, `2s` and
`4s`. The `30_000` cap is inert at three attempts and exists so the constant
survives a future raise of the attempt count. Jitter is ±20%: `random()` of
`0.5` yields exactly the nominal delay.

### Conventions

- **Error classification.** `HttpErrorResponse` with `status === 0` is
  `'network'` — that is what a CORS rejection or an offline browser produces. A
  `TimeoutError` is also `'network'`. Any other `HttpErrorResponse` is `'http'`
  and carries its `status`. A `GbfsMapperError` is `'schema'`.
- **`attempts`.** The number of HTTP attempts spent, so a fully retried failure
  reports `4` (one initial plus three retries) and a schema failure reports `1`.
- **Interval source.** The delay before the next tick is the last successful
  snapshot's `ttlMs`. Before any success, and after an error, the last known good
  value is used; with none, `60_000`.
- **Never fails, never completes.** `PollResult` carries the failure as a value.
  An observable that errors would end the polling, and an observable that
  completes would end it silently.

## Implementation plan

Each step is independently commitable and leaves `npm run lint && npm run build && npm test` green.

1. **HTTP wiring.** Add `provideHttpClient(withFetch())` to `app.config.ts` and
   create `src/app/core/gbfs/gbfs-feed-url.ts` with the `GBFS_FEED_URL` token,
   provided in `app.config.ts` as `/api/gbfs/free_bike_status.json`. Nothing
   consumes either yet. Verify: `npm run build` passes.

2. **`GbfsApi`.** Create `src/app/core/gbfs/gbfs-api.ts` with a `@Service`
   singleton injecting `HttpClient` and `GBFS_FEED_URL`, exposing
   `fetchVehicleStatus(): Observable<unknown>` — a single `http.get<unknown>(url)`
   with no retry, no timeout and no mapping. Add `gbfs-api.spec.ts` with
   `provideHttpClientTesting`: asserts the requested URL, that the response body
   passes through untouched, and that an HTTP error propagates as an error rather
   than being swallowed.

3. **Result types.** Create `src/app/core/polling/poll-result.ts` with
   `PollErrorKind`, `PollError` and `PollResult`, and
   `src/app/core/polling/random.ts` with the `RANDOM` token. Types and one token,
   no logic.

4. **Error classification.** Add a `toPollError(cause: unknown, attempts: number): PollError`
   helper in `src/app/core/polling/poll-error.ts`. Tests cover each branch:
   `HttpErrorResponse` with `status: 0` → `'network'`, `status: 503` → `'http'`
   carrying `503`, `TimeoutError` → `'network'`, `GbfsMapperError` → `'schema'`,
   and an unknown throwable → `'network'` with a generic message.

5. **Backoff function.** Add an exported pure `backoffDelay(attempt: number, random: () => number): number`
   in `src/app/core/polling/backoff.ts`. Tests: `random` fixed at `0.5` yields
   `1000`, `2000`, `4000` for attempts `0`, `1`, `2`; the cap holds at high
   attempt numbers; `random` at `0` and `1` yield the ±20% bounds.

6. **One tick.** Create `src/app/core/polling/vehicle-polling.ts` with a
   `@Service` singleton injecting `GbfsApi`, `GbfsMapper` and `RANDOM`, exposing
   `snapshots$` as a cold observable that performs exactly one fetch → `timeout(15_000)`
   → map → `PollResult`, with no interval and no retry yet. Failures are caught
   and emitted as `{ kind: 'error' }`. Tests: a good payload emits `kind: 'success'`
   with the mapped snapshot; an HTTP 503 emits `kind: 'error'` with
   `kind: 'http'`; a hang past 15s emits `kind: 'network'`.

7. **Retry and backoff.** Wrap the fetch in `retry({ count: 3, delay })`, where
   `delay` uses `backoffDelay` and rethrows a `GbfsMapperError` immediately
   instead of scheduling. Tests with `vi.useFakeTimers()`: a 503 followed by a
   success on attempt 2 emits one `success`; three 503s then a fourth emit one
   `error` with `attempts: 4`; the retries land at exactly `1000`, `2000` and
   `4000` ms with `RANDOM` stubbed to `0.5`; a `GbfsMapperError` emits after a
   single attempt with no timer advance.

8. **The interval.** Turn `snapshots$` into a repeating stream whose delay before
   the next tick comes from the last successful snapshot's `ttlMs`, falling back
   to the last known good value and then to `60_000`. The first tick fires
   immediately. Tests: the second request is issued at `ttlMs` after the first
   completes; a feed advertising `ttl: 30` produces a `30_000` gap; a failing tick
   does not stop the stream and the next tick still fires; unsubscribing before a
   tick cancels the in-flight request and issues no further ones.

9. **README correction.** Update the layer diagram and service names in
   `README.md` to `GbfsApi` and `VehiclePolling`, document the retry policy and
   the `15s` timeout in one short block, and note that `GBFS_FEED_URL` is the seam
   a production deployment repoints.

10. **Live verification.** Run `npm start`, subscribe to `snapshots$` from a
    throwaway `main.ts` log, and confirm against the real Lime feed: the first
    emission is `kind: 'success'` with roughly 3,100 vehicles and
    `droppedCount === 0`, and a second emission follows about 60 seconds later.
    Revert the throwaway logging before committing; record the observed numbers in
    the commit message.

## Acceptance criteria

**Build and tooling**

- [x] `npm ci && npm run build` completes with no errors.
- [x] `npm run lint` passes, including the `prettier/prettier` rule.
- [x] `npm test` passes and every test added by this spec is green.
- [x] No `any` appears in any file added by this spec.

**Boundary**

- [x] `maplibre-gl` is not imported by any file in this spec.
- [x] `gbfs.types.ts` is still imported only from inside `src/app/core/gbfs/`.
- [x] `gbfs-api.ts` imports nothing from `src/app/core/models/` and nothing from
      `src/app/core/polling/`.
- [x] `GbfsApi.fetchVehicleStatus()` is typed `Observable<unknown>` and its body
      contains no `retry`, no `timeout` and no mapper call.
- [x] `VehiclePolling` is the only file that calls `GbfsMapper.toSnapshot`.
- [x] Both services are decorated with `@Service` and neither declares
      `standalone: true` nor `changeDetection`.
- [x] Resolving `GBFS_FEED_URL` without a provider throws at injection.

**Fetching**

- [x] `fetchVehicleStatus()` issues exactly one `GET` to the value of
      `GBFS_FEED_URL`.
- [x] The response body reaches the caller structurally unchanged.
- [x] `app.config.ts` provides `provideHttpClient(withFetch())`.

**Result contract**

- [x] A successful fetch of the committed Lime fixture emits exactly one
      `{ kind: 'success' }` carrying the snapshot `GbfsMapper` returns for that
      payload.
- [x] `snapshots$` never emits an error notification and never completes on its
      own, for every failure case tested.
- [x] Unsubscribing cancels the in-flight request and issues no further ones.

**Error classification**

- [x] An `HttpErrorResponse` with `status === 0` yields `kind: 'network'`.
- [x] An `HttpErrorResponse` with `status === 503` yields `kind: 'http'` and
      `status === 503`.
- [x] A request that never settles emits `kind: 'network'` at `15_000` ms, and
      not before.
- [x] A payload that makes `GbfsMapper.toSnapshot` throw yields `kind: 'schema'`.

**Retry and backoff**

- [x] With `RANDOM` stubbed to `() => 0.5`, retries are issued at exactly
      `1000`, `2000` and `4000` ms after their preceding failure.
- [x] `backoffDelay` with `random` at `0` returns `800` for attempt `0`, and with
      `random` at `1` returns `1200`.
- [x] `backoffDelay(10, () => 0.5)` returns `30_000`.
- [x] Two failures followed by a success emit exactly one `PollResult`, of
      `kind: 'success'`.
- [x] Four consecutive HTTP failures emit exactly one `PollResult`, of
      `kind: 'error'`, with `attempts === 4`.
- [x] A `GbfsMapperError` emits `kind: 'error'` with `attempts === 1` and issues
      no second HTTP request.
- [x] A tick that exhausted its retries is followed by a fresh tick whose failure
      budget is again `3`.

**Interval**

- [x] The first tick issues its request without any timer advance.
- [x] After a snapshot with `ttlMs === 60000`, the next request is issued
      `60_000` ms later and not before.
- [x] A feed advertising `ttl: 30` produces a `30_000` ms gap to the next
      request.
- [x] After a failed tick, the next request is issued at the last known good
      `ttlMs`, and at `60_000` ms if there has never been a success.

**Live feed**

- [x] Against the running dev proxy, the first emission is `kind: 'success'`
      with over 3,000 vehicles and `droppedCount === 0`.
- [x] A second emission arrives roughly 60 seconds after the first.
- [x] No throwaway logging from step 10 remains in the committed tree.

**Documentation**

- [x] The layer diagram in `README.md` names `GbfsApi` and `VehiclePolling`, and
      no occurrence of `GbfsApiService` or `PollingService` remains.
- [x] `README.md` states the retry policy, the `15s` timeout, and that
      `GBFS_FEED_URL` is the seam a production deployment repoints.

## Decisions

**Boundary and layering**

- **Yes:** `GbfsApi` returns `Observable<unknown>` and knows nothing about
  `Vehicle`. It is the layer with nothing to test beyond "the URL is right", and
  that is the point — all the testable logic lives in the mapper and the polling.
- **Yes:** `VehiclePolling` calls the mapper, not `GbfsApi`. `CLAUDE.md` requires
  a swap of provider to touch only the api and the mapper; if the api mapped, it
  would need to know both the feed and the domain.
- **Yes:** `VehiclePolling` lives in `src/app/core/polling/`, not in
  `src/app/core/gbfs/`. The directory boundary is the visible statement that the
  polling survives a provider swap untouched.
- **No:** the `.service.ts` suffix. SPEC 01 shipped `gbfs-mapper.ts` →
  `GbfsMapper`, which is the Angular v20+ convention, and one directory should
  not hold two naming schemes. `README.md` is corrected instead.

**Error surfacing**

- **Yes:** a `PollResult` discriminated union. The stream must outlive its own
  failures; carrying the error as a value is the only shape where "the feed is
  down" and "the feed is back" are both ordinary emissions.
- **No:** letting the observable error. It would end the polling on the first
  502, which is exactly the moment retrying matters.
- **No:** a second `errors$` stream. Two streams means the store has to reconcile
  their ordering to know whether the current state is stale.
- **No:** `catchError` returning the last good snapshot. It hides the outage,
  and the rubric grades a visible error state.
- **Yes:** `attempts` and `at` on `PollError`. They cost two fields and let the
  UI say "failed 4 times, 30 seconds ago" instead of "error".

**Retry policy**

- **Yes:** three retries with `1s → 2s → 4s`. The feed's `ttl` is 60s, so the
  whole retry budget plus a 15s timeout still fits inside one interval and cannot
  overlap the next tick.
- **Yes:** the counter resets on every successful tick. A session-wide budget
  would mean an app left open overnight stops retrying after three transient
  blips.
- **Yes:** `GbfsMapperError` skips retry. A corrupt envelope is deterministic —
  three more identical requests produce three more identical failures, delaying
  the error state by seven seconds for nothing.
- **No:** retrying 4xx separately from 5xx. Distinguishing them is more branching
  than a 4–6 hour budget earns, and the classification into `'http'` already
  carries the status for the UI to reason about.
- **Yes:** the `30_000` cap, even though three attempts never reach it. It
  documents the ceiling for whoever raises the attempt count.

**Jitter**

- **Yes:** ±20% jitter behind a `RANDOM` injection token. Jitter is the correct
  default for backoff, and the token keeps the timing assertions exact.
- **No:** dropping jitter for determinism. It would trade a real property for a
  test convenience the token already provides.

**Interval**

- **Yes:** the interval is read from the last snapshot's `ttlMs`. SPEC 01 kept
  `ttl` on `VehicleSnapshot` specifically so this layer would not have to re-read
  the raw payload; ignoring it here would make that decision pointless.
- **No:** a hardcoded `60_000`. It silently desynchronises the moment a provider
  changes its `ttl`, and polling faster than `ttl` is wasted traffic.
- **Yes:** delay measured from tick completion, not tick start. A fixed-rate
  `interval()` would queue overlapping requests when the feed is slow.
- **Yes:** first tick fires immediately. An app that shows nothing for its first
  60 seconds is broken, whatever the rubric says about polling.

**Shape and lifecycle**

- **Yes:** a cold observable. There is exactly one subscriber (`VehicleStore`,
  SPEC 03), so sharing buys nothing, and cold means a test subscription is a
  complete, isolated lifecycle.
- **No:** auto-starting in the constructor. Injection would fire HTTP as a side
  effect, and every test touching the service would need to intercept it.
- **No:** `shareReplay`. Its `refCount` and buffer semantics are a recurring
  source of leaks, for a multi-subscriber case that does not exist.
- **Yes:** a 15s per-request timeout. Without it a hung connection is
  indistinguishable from a slow one until the next tick cancels it, and the user
  sees neither data nor an error for a full minute.

**Configuration**

- **Yes:** `GBFS_FEED_URL` as an `InjectionToken` with no factory. The dev proxy
  path is a deployment detail, not a constant of the domain, and a missing
  provider should fail at injection rather than default to a URL that only works
  on localhost.
- **No:** `src/environments/`. Angular 22 no longer scaffolds it, and adding a
  build-configuration fileset to hold one string is disproportionate.
- **No:** a constant exported from `gbfs-api.ts`. It works until a test or a
  second environment needs a different URL, and then it becomes a refactor.

**Testing**

- **Yes:** `provideHttpClientTesting` with `vi.useFakeTimers()`.
  `HttpTestingController` gives exact control over how many requests were issued
  — which is what the retry and cancellation assertions actually measure.
- **No:** RxJS `TestScheduler` marbles. Marble timing and `HttpTestingController`
  flushing fight each other, and debugging that fight is not what this spec is
  for.
- **Yes:** `backoffDelay` and `toPollError` as exported pure functions with their
  own tests. The alternative is asserting jitter bounds through a timer-driven
  integration test, which is slower and less precise.
- **Yes:** a manual live-feed verification as an acceptance criterion. Every
  automated test in this spec runs against mocks; without one real call, the
  whole HTTP path could be green and broken.

## Risks

| Risk                                                                                                                                                                 | Mitigation                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A production build has no dev proxy, so `GBFS_FEED_URL` points at a path that 404s and every tick fails with `kind: 'http'`.                                         | The token is the documented repoint seam, and `README.md` already lists the missing CORS header under known limitations. The failure is a visible error state, not a crash.         |
| A provider advertising a tiny `ttl` (say `1`) would turn the interval into a request-per-second flood.                                                               | Not mitigated in code, and deliberately so — Lime advertises `60` and a floor is untested speculation. Recorded here so that whoever sees the flood knows where it comes from.      |
| `retry` with a `delay` callback that rethrows for `GbfsMapperError` is subtle. Getting the branch backwards would silently retry schema errors, or never retry HTTP. | Both directions are covered by acceptance criteria: `attempts === 4` for HTTP failures and `attempts === 1` with no second request for schema failures.                             |
| Fake timers plus `HttpTestingController` interleave awkwardly: a `tick` that fires before a request is flushed produces a test that passes for the wrong reason.     | Each timing test asserts the request count at both sides of the advance, so "no request yet" is checked explicitly rather than inferred.                                            |
| `withFetch()` reports network and CORS failures as `status === 0` with an opaque message, so `'network'` absorbs several distinct causes.                            | `'network'` is deliberately the catch-all bucket. The UI copy for it is written in SPEC 03 and has to stay generic anyway.                                                          |
| The live-feed verification in step 10 requires temporary code in `main.ts` that must not be committed.                                                               | An acceptance criterion checks the committed tree is clean, and the observed numbers go in the commit message so the verification leaves a trace without leaving code.              |
| The whole retry budget plus timeout is 22s against a 60s `ttl`. A provider with a `ttl` under 25s could see a retry sequence outlast its own interval.               | The interval is measured from tick completion, not tick start, so a slow tick delays the next one rather than overlapping it. No request is ever issued while another is in flight. |

## What is **not** in this spec

- `VehicleStore`, signals, `computed()` derived state, and the
  `loading → loaded → empty → error` transitions.
- The `droppedCount` threshold at which a degraded feed becomes a user-visible
  error.
- A manual `refresh()` tick and the retry button that would call it.
- Pausing the stream on `visibilitychange`.
- Caching, deduplication, or serving a stale snapshot during a retry.
- A working production deployment of the feed call.
- Any component, template, map or `maplibre-gl` code.

Each one of those, if it lands, goes in its own spec.
