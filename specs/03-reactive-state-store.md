# SPEC 03 — Reactive vehicle store

> **Status:** Implemented
> **Depends on:** SPEC 01, SPEC 02
> **Date:** 2026-07-30
> **Objective:** Add `VehicleStore`, the single source of truth that subscribes to `VehiclePolling`, exposes the feed as signals, and owns the `idle → loading → loaded/empty/error` transitions and the vehicle selection.

## Scope

**In:**

- `VehicleStore`, a `@Service` singleton in `src/app/core/state/vehicle-store.ts`, holding every piece of feed state the UI reads.
- Private writable signals — `#snapshot`, `#error`, `#selectedId`, `#started` — and public `computed()` accessors. No writable signal is exposed.
- The `StoreStatus` union `'idle' | 'loading' | 'loaded' | 'empty' | 'error'`, derived from the private signals, in `src/app/core/state/store-status.ts`.
- Public read surface: `status()`, `vehicles()`, `selected()`, `selectionLost()`, `error()`, `lastUpdated()`, `droppedCount()`.
- Public commands: `start()`, `refresh()`, `select(id)`, `clearSelection()`.
- `start()` is idempotent: the second call is a no-op, and the subscription is torn down with `takeUntilDestroyed`.
- `refresh()` cancels the running subscription and resubscribes, which fires an immediate tick by `VehiclePolling`'s design.
- Stale-data semantics: an error that arrives after a successful tick populates `error()` and leaves `vehicles()` and `status()` untouched. A later success clears `error()`.
- Selection survives ticks. A selected vehicle that disappears from the feed keeps its id, makes `selected()` return `undefined`, and raises `selectionLost()`.
- `app.ts` calls `store.start()` once, so the stream runs in the browser. No template or styling work beyond that call.
- Unit tests in `src/app/core/state/vehicle-store.spec.ts`, driving a `VehiclePolling` double whose `snapshots$` is a `Subject<PollResult>`.
- A `README.md` update naming `VehicleStore` in the layer diagram and documenting the five states and the stale-on-error rule.

**Out of scope (for future specs):**

- Every component, template, panel, list and map. This spec ships no UI.
- `maplibre-gl` and `MapLibreService`.
- Filters over the vehicle list (battery range, status). Bonus territory, and the store would need to own filter signals.
- Bidirectional hover, fly-to and URL deep-linking of the selection.
- Pausing the stream on `visibilitychange`.
- A `droppedCount` threshold that turns a degraded feed into an error state. The number is exposed and never escalated.
- Caching or persisting the last snapshot across reloads.
- Any change to `GbfsApi`, `GbfsMapper` or `VehiclePolling`. If this spec needs one, that is a signal the seam was wrong.

## Data model

This spec introduces no domain data. It reuses `Vehicle` and `VehicleSnapshot`
from SPEC 01 and `PollResult` / `PollError` from SPEC 02. What it does introduce
is one status type and the rules that derive the public surface from it.

### Status — `src/app/core/state/store-status.ts`

```typescript
export type StoreStatus = 'idle' | 'loading' | 'loaded' | 'empty' | 'error';
```

### Internal state — `src/app/core/state/vehicle-store.ts`

```typescript
readonly #snapshot = signal<VehicleSnapshot | null>(null);
readonly #error = signal<PollError | null>(null);
readonly #selectedId = signal<string | null>(null);
readonly #started = signal(false);
```

Four writable signals, all private. Everything the UI reads is a `computed()`
over them, so no two public values can disagree.

### Derivation of `status()`

| `#started` | `#snapshot`       | `#error` | `status()`  |
| ---------- | ----------------- | -------- | ----------- |
| `false`    | —                 | —        | `'idle'`    |
| `true`     | `null`            | `null`   | `'loading'` |
| `true`     | `null`            | set      | `'error'`   |
| `true`     | `vehicles: []`    | —        | `'empty'`   |
| `true`     | `vehicles: [...]` | —        | `'loaded'`  |

`—` means the column does not affect the outcome.

The last two rows are the stale-data rule: once a snapshot exists, an error
never changes the status. `error()` is set alongside it and the UI renders a
banner over the data it already has.

### Public read surface

| Signal            | Type                   | Value with no snapshot |
| ----------------- | ---------------------- | ---------------------- |
| `status()`        | `StoreStatus`          | per the table above    |
| `vehicles()`      | `readonly Vehicle[]`   | `EMPTY_VEHICLES`       |
| `selected()`      | `Vehicle \| undefined` | `undefined`            |
| `selectionLost()` | `boolean`              | `false`                |
| `error()`         | `PollError \| null`    | `null`                 |
| `lastUpdated()`   | `number \| null`       | `null`                 |
| `droppedCount()`  | `number`               | `0`                    |

### Conventions

- **`EMPTY_VEHICLES`.** A single module-level frozen array, returned whenever
  there is no snapshot, so `vehicles()` keeps referential stability and a
  `@for` track does not see a new empty array on every read.
- **`selected()`** looks the id up in the current snapshot: it is always a
  vehicle from the live feed or `undefined`, never a cached copy.
- **`selectionLost()`** is `true` only when a snapshot exists, `#selectedId` is
  set, and the lookup misses. Before the first snapshot it is `false` — the
  selection is pending, not lost.
- **Error lifetime.** `#error` is set on `{ kind: 'error' }` and cleared on the
  next `{ kind: 'success' }`. It is never cleared by time.
- **Ingestion.** Each `PollResult` writes at most two signals. Nothing else in
  the app writes to them.

## Implementation plan

Each step is independently commitable and leaves `npm run lint && npm run build && npm test` green.

1. **Status type and store skeleton.** Create
   `src/app/core/state/store-status.ts` with the `StoreStatus` union, and
   `src/app/core/state/vehicle-store.ts` with a `@Service` singleton holding
   `#snapshot`, `#error` and `#started`, the module-level `EMPTY_VEHICLES`
   constant, and the `status()`, `vehicles()`, `error()`, `lastUpdated()` and
   `droppedCount()` computeds. No subscription, no selection. Injecting the
   store yields `status() === 'idle'` and issues no HTTP.

2. **Ingestion and `start()`.** Inject `VehiclePolling` and `DestroyRef`. Add
   `start()`: it returns early when `#started()` is already true, otherwise sets
   it and subscribes to `snapshots$` through
   `takeUntilDestroyed(this.#destroyRef)`. A `'success'` writes `#snapshot` and
   clears `#error`; an `'error'` writes `#error` and leaves `#snapshot` alone.
   Add `vehicle-store.spec.ts` with a `VehiclePolling` double exposing a
   `Subject<PollResult>`. Tests: `idle` before `start()`; `loading` after
   `start()` with nothing emitted; `loaded` after a snapshot with vehicles;
   `empty` after a snapshot with none; `error` when the first emission is a
   failure; a failure after a success keeps `status() === 'loaded'` and the same
   `vehicles()` while setting `error()`; a later success clears `error()`; two
   `start()` calls produce one subscription.

3. **Selection.** Add `#selectedId`, the `select(id)` and `clearSelection()`
   commands, and the `selected()` and `selectionLost()` computeds. `select` with
   the already selected id changes nothing. Tests: `select` resolves the vehicle
   from the current snapshot; the selection survives a tick that still contains
   the id and resolves to the new object identity; a tick without the id leaves
   `selected()` undefined and `selectionLost()` true; `clearSelection()` resets
   both; selecting before any snapshot leaves `selected()` undefined and
   `selectionLost()` false.

4. **`refresh()`.** Store the `Subscription` from `start()`. `refresh()`
   unsubscribes it and resubscribes, which fires an immediate tick because
   `VehiclePolling`'s first tick has no delay. Before `start()` it is a no-op.
   Tests: `refresh()` after an error issues a fresh subscription and a following
   success clears `error()`; the pre-refresh subject no longer reaches the store;
   `refresh()` on an unstarted store leaves `status() === 'idle'` and subscribes
   to nothing.

5. **Teardown.** Verify the destroy path: destroying the `TestBed` injector
   unsubscribes, and a `PollResult` pushed afterwards changes no signal. If
   step 2 wired `takeUntilDestroyed` correctly this step is a test, not code.

6. **Wire the app.** Inject `VehicleStore` in `app.ts` and call `start()` once
   from its constructor. No template change. `npm start` now polls the live feed
   with nothing rendering it.

7. **README.** Add `VehicleStore` to the layer diagram, document the five
   statuses in one short table, and state the stale-on-error rule and that
   `droppedCount` is surfaced but never escalated to an error.

8. **Live verification.** With `npm start` running, log `status()`,
   `vehicles().length` and `droppedCount()` from a throwaway `effect()` in
   `app.ts`. Confirm `idle → loading → loaded` with roughly 3,100 vehicles and
   `droppedCount === 0`, and a second `loaded` about 60 seconds later. Revert the
   logging before committing and record the observed numbers in the commit
   message.

## Acceptance criteria

**Build and tooling**

- [x] `npm ci && npm run build` completes with no errors.
- [x] `npm run lint` passes, including the `prettier/prettier` rule.
- [x] `npm test` passes and every test added by this spec is green.
- [x] No `any` appears in any file added by this spec.

**Boundary**

- [x] `maplibre-gl` is not imported by any file in this spec.
- [x] `vehicle-store.ts` imports nothing from `src/app/core/gbfs/`.
- [x] No file in `src/app/core/gbfs/` or `src/app/core/polling/` imports
      `VehicleStore`.
- [x] `GbfsApi`, `GbfsMapper` and `VehiclePolling` are unchanged by this spec.
- [x] `VehicleStore` is decorated with `@Service` and declares neither
      `standalone: true` nor `changeDetection`.
- [x] Every public member of `VehicleStore` is either a `computed()` or a
      command method. No `WritableSignal` is reachable from outside the class.

**Status transitions**

- [x] A freshly injected store reports `status() === 'idle'` and issues no
      request.
- [x] After `start()` with nothing emitted yet, `status() === 'loading'`.
- [x] A first `{ kind: 'success' }` carrying vehicles moves `status()` to
      `'loaded'`.
- [x] A first `{ kind: 'success' }` carrying `vehicles: []` moves `status()` to
      `'empty'`.
- [x] A first `{ kind: 'error' }` moves `status()` to `'error'` and `error()` is
      the emitted `PollError`.
- [x] A snapshot arriving after that error moves `status()` to `'loaded'` and
      sets `error()` to `null`.

**Stale data on error**

- [x] An error after a successful tick leaves `status() === 'loaded'`.
- [x] That error leaves `vehicles()` referentially identical to the pre-error
      value.
- [x] That error sets `error()` to the emitted `PollError`.
- [x] The next successful tick clears `error()` to `null` and replaces
      `vehicles()`.
- [x] With no snapshot, `vehicles()` returns the same array instance on every
      read.

**Selection**

- [x] `select(id)` with an id present in the snapshot makes `selected()` return
      that vehicle.
- [x] Calling `select` twice with the same id leaves `selected()` unchanged and
      does not clear it.
- [x] After a tick that still contains the selected id, `selected()` returns the
      vehicle from the new snapshot.
- [x] After a tick that drops the selected id, `selected()` is `undefined` and
      `selectionLost()` is `true`.
- [x] `clearSelection()` sets `selected()` to `undefined` and `selectionLost()`
      to `false`.
- [x] `select(id)` before any snapshot leaves `selected()` undefined and
      `selectionLost()` `false`.
- [x] An error emission does not change `selected()`.

**Lifecycle**

- [x] Two `start()` calls result in exactly one subscription to `snapshots$`.
- [x] `refresh()` after an error unsubscribes the previous stream and subscribes
      anew.
- [x] After `refresh()`, a `PollResult` pushed through the pre-refresh stream
      changes no signal.
- [x] `refresh()` on a store that never started leaves `status() === 'idle'` and
      creates no subscription.
- [x] Destroying the injector unsubscribes: a `PollResult` pushed afterwards
      changes no signal.

**Derived values**

- [x] `lastUpdated()` is `null` before the first snapshot and the snapshot's
      `lastUpdated` after it.
- [x] `droppedCount()` is `0` before the first snapshot and the snapshot's
      `droppedCount` after it.
- [x] A snapshot with a non-zero `droppedCount` still yields
      `status() === 'loaded'`.

**Live feed**

- [x] With `npm start` running, the store passes through
      `idle → loading → loaded` with over 3,000 vehicles and
      `droppedCount === 0`.
- [x] A second `loaded` snapshot arrives roughly 60 seconds after the first.
- [x] No throwaway logging from step 8 remains in the committed tree.

**Documentation**

- [x] The layer diagram in `README.md` names `VehicleStore`.
- [x] `README.md` documents the five statuses, the stale-on-error rule, and that
      `droppedCount` is never escalated to an error.

## Decisions

**State shape**

- **Yes:** four private writable signals plus public `computed()` accessors. One
  fact has one owner, so `status()`, `vehicles()` and `error()` cannot contradict
  each other — they are all views of the same two signals.
- **No:** public `WritableSignal` per field (`loading`, `error`, `vehicles`). It
  reads flatter and lets any component write, which is how a store stops being a
  single source of truth.
- **No:** one signal holding a discriminated `{ kind: 'loaded', vehicles }`
  union. It makes invalid states unrepresentable, but "an error while showing the
  previous data" is a valid state here, and expressing it would need either a
  nested snapshot inside the error variant or a second signal anyway.
- **Yes:** `StoreStatus` in its own file. The UI spec needs the type for a
  `@switch`; importing the store class to get a string union is a needless
  coupling.

**Error semantics**

- **Yes:** an error after a success keeps the data and sets `error()`. A
  transient blip must not blank a map with 3,100 vehicles on it; the retry
  policy from SPEC 02 already means an error survived four attempts.
- **No:** clearing the vehicles on any error. Simpler, and it flickers the whole
  view every time the network hiccups.
- **Yes:** `status() === 'error'` only when no snapshot ever arrived. That is the
  one case where there is nothing to show, so it is the one case that earns a
  full-screen error state.
- **Yes:** `error()` cleared by the next success and by nothing else. Clearing it
  on a timer would make the banner disappear while the feed is still down.

**Lifecycle**

- **Yes:** an explicit, idempotent `start()`. It matches SPEC 02's refusal to
  fire HTTP from a constructor, and it keeps `TestBed.inject(VehicleStore)` free
  of side effects.
- **No:** subscribing at field initialisation with `toSignal`. Zero ceremony, but
  then every test that touches the store — including the UI specs — has to
  intercept the stream.
- **No:** `provideAppInitializer`. It would block bootstrap on a decision that
  belongs to the component tree, and it hides the subscription from anyone
  reading `app.ts`.
- **Yes:** `takeUntilDestroyed(this.#destroyRef)` with an injected `DestroyRef`.
  `start()` runs outside the injection context, where the no-argument form
  throws.
- **Yes:** `refresh()` lives in the store, not in the UI spec. SPEC 02 deferred
  it here explicitly, and a retry button that reaches into the polling service
  would bypass the store it is supposed to be refreshing.
- **Yes:** `refresh()` implemented as unsubscribe-and-resubscribe. `snapshots$`
  is cold and its first tick has no delay, so resubscribing _is_ an immediate
  out-of-band tick — no new API on `VehiclePolling`.
- **Yes:** `refresh()` before `start()` is a no-op. Two ways to start the stream
  is one too many.

**Selection**

- **Yes:** store the id, resolve the vehicle. The alternative stores a `Vehicle`
  object that silently ages into a lie the moment the next tick lands.
- **Yes:** `selectionLost()` as a distinct signal. It lets the detail panel say
  "this vehicle is no longer in the feed" instead of vanishing while the user
  reads it.
- **No:** clearing the selection silently when the vehicle disappears. It is the
  cheapest option and the most confusing one.
- **Yes:** `select(id)` and `clearSelection()` as two verbs. `select(null)` reads
  badly in a template.
- **Yes:** `select` is idempotent. A toggle surprises the user when the same id
  arrives from both the map and the list, which is exactly the bidirectional sync
  the brief grades.
- **Yes:** a linear scan in `selected()`. `computed()` recomputes it once per
  tick, not once per render; a `Map` index would add an invalidation path to save
  microseconds.

**Empty and degraded feeds**

- **Yes:** `'empty'` as a named status. The brief grades the empty state as its
  own requirement, and naming it in the core means the template cannot forget it.
- **Yes:** `droppedCount()` exposed and never escalated. A feed with 3,000 good
  vehicles and five bad ones is usable; the live feed drops zero, so any
  threshold would be a number invented without data.
- **No:** a percentage threshold that flips the store into `'error'`. Deferred
  twice already, and still nothing measured justifies a value.

**Testing**

- **Yes:** a `VehiclePolling` double backed by a `Subject<PollResult>`. The
  transitions under test are ordering, not timing, so pushing emissions by hand
  is both exact and fast — no fake timers, no HTTP.
- **No:** `provideHttpClientTesting` with the real `VehiclePolling`. It would
  re-assert SPEC 02's retry and interval behaviour through a second layer, and a
  store test would fail for reasons that have nothing to do with the store.
- **Yes:** a live verification step, as in SPEC 02. Every automated test here
  runs against a double; without one real run, the wiring in `app.ts` could be
  wrong and everything still green.

## Risks

| Risk                                                                                                                                                                               | Mitigation                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `refresh()` assumes `VehiclePolling`'s first tick has no delay. A future initial delay in that service would make the retry button silently slow instead of broken.                | The assumption is already an acceptance criterion of SPEC 02 ("the first tick issues its request without any timer advance"). Recorded here so the coupling is written down rather than remembered. |
| `start()` is called from `app.ts`, so a UI refactor that replaces the root component drops the call and the app shows `'loading'` forever with no error.                           | `'idle'` and `'loading'` are distinct statuses, so a store that never started is visibly different from one waiting on the network. The live verification step exercises the real call.             |
| The stale-on-error rule can be implemented by copying the vehicle array, which would repaint every marker and list row on each transient failure.                                  | An acceptance criterion asserts `vehicles()` is referentially identical across an error, so a copy fails the test.                                                                                  |
| `takeUntilDestroyed` without an explicit `DestroyRef` throws at runtime when `start()` runs outside the injection context — and a root-singleton store is rarely destroyed in dev. | The `DestroyRef` is injected as a field in step 2, and the teardown test in step 5 destroys the injector explicitly rather than trusting it.                                                        |
| `selected()` scans ~3,100 vehicles. If a later spec calls it inside a `@for` body, the scan becomes quadratic.                                                                     | `computed()` caches per snapshot, so the cost is per tick. The UI spec compares ids inside loops instead of calling `selected()` — noted there when it is written.                                  |
| A degraded feed that drops most vehicles reports `'loaded'` with a near-empty map and no warning.                                                                                  | Accepted deliberately: `droppedCount()` is exposed for the UI to surface. The live feed drops zero, and no measured threshold exists.                                                               |

## What is **not** in this spec

- Every component, template, panel, list and map. This spec ships no UI beyond
  one `start()` call.
- `maplibre-gl` and `MapLibreService`.
- Filters over the vehicle list.
- Bidirectional hover, fly-to and URL deep-linking.
- Pausing the stream on `visibilitychange`.
- A `droppedCount` threshold that escalates to an error state.
- Caching or persisting the last snapshot across reloads.
- Any change to `GbfsApi`, `GbfsMapper` or `VehiclePolling`.

Each one of those, if it lands, goes in its own spec.
