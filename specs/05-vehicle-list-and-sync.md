# SPEC 05 — Vehicle list, detail panel and map↔list sync

> **Status:** Implemented
> **Depends on:** SPEC 01, SPEC 02, SPEC 03, SPEC 04
> **Date:** 2026-07-31
> **Objective:** Add the app shell around the map — a virtual-scrolled vehicle list, a detail panel for the selected vehicle, and the loading/empty/error states — all bound to `VehicleStore.selected()` so that a click on the map highlights and scrolls to the list row and a click on a row highlights the map.

## Scope

**In:**

- `@angular/cdk` added to `dependencies`, for `ScrollingModule` /
  `cdk-virtual-scroll-viewport` only.
- `NOW` injection token in `src/app/core/time/now.ts`, modelled on `RANDOM`. The
  UI's only source of wall-clock time. `poll-error.ts` is left untouched.
- Pure formatting helpers in `src/app/core/format/vehicle-format.ts` + spec:
  `formatRange(meters?)` → `"18.4 km"` / `"no data"`,
  `formatRelativeTime(epochMs, now)` → `"2 min ago"`,
  `formatCoordinates(coordinates)` → 5 decimals. No Angular imports.
- `bucketFor(rangeMeters?)` added to `src/app/core/map/range-buckets.ts`, so the
  list dot and the panel read the same colour the paint spec uses. Additive — no
  existing export changes.
- `VehicleListComponent` in
  `src/app/features/vehicles/vehicle-list.component.ts`: a
  `cdk-virtual-scroll-viewport` with `role="listbox"`, one `role="option"` row
  per vehicle, `@for` tracked by `vehicle.id`. Row shows the range bucket dot,
  the id, the range and the relative `lastReported`.
- List keyboard model: roving `tabindex` (one tab stop for the whole listbox),
  `ArrowUp`/`ArrowDown` move the active row, `Home`/`End` jump to the ends,
  `Enter`/`Space` select, `aria-selected` on the selected row, and
  `aria-activedescendant` on the viewport.
- Map → list auto-scroll: an `effect()` on `store.selected()` resolves the index
  in `store.vehicles()` and calls `viewport.scrollToIndex(index, 'smooth')`.
  Guarded so a selection the list itself originated does not re-scroll.
- `VehicleDetailPanelComponent` in
  `src/app/features/vehicles/vehicle-detail-panel.component.ts`: renders above
  the list inside the sidebar, showing id, `vehicleType`, `status`, range with
  its bucket colour, coordinates and "last seen X ago". Closes with a `×` button and
  with `Escape`, both calling `store.clearSelection()`.
- `selectionLost()` consumed by the panel: when the selected vehicle vanishes
  from a later snapshot, the panel stays open with a "no longer in the feed"
  notice and a close action, instead of disappearing silently.
- `VehicleSidebarComponent` in
  `src/app/features/vehicles/vehicle-sidebar.component.ts`: composes panel and
  list, renders the header (vehicle count, `lastUpdated`), and owns the
  **no-data** states — `loading` skeleton, `empty` message, `error` message with
  a **Retry** button calling `store.refresh()`.
- `FeedStatusBannerComponent` in
  `src/app/features/shell/feed-status-banner.component.ts`: a thin full-width bar
  shown only when `status() === 'loaded'` **and** `error() !== null` — stale data
  over a live map. Carries the age of the data and its own Retry. Visible in
  both layouts, so a failing feed is never hidden behind a closed drawer.
- Layout in `app.html` / `app.css`: split shell, map plus a 380px sidebar on
  `≥768px`. Below that the sidebar becomes a bottom drawer that **starts closed**,
  opened by a "View list (N)" button over the map and closed by `×` or `Escape`.
- Specs: `vehicle-format.spec.ts`, `vehicle-list.component.spec.ts`,
  `vehicle-detail-panel.component.spec.ts`, `vehicle-sidebar.component.spec.ts`.
  All against `VehicleStore` with a stubbed `VehiclePolling`, as in SPEC 04.
- `README.md` update: the shell in the layer diagram, the bidirectional sync
  path, the list as the accessible path to every vehicle (closing the promise
  SPEC 04 made), and the four UI states.

**Out of scope (for future specs):**

- Fly-to / camera movement on list selection. Needs a new `MapLibreService`
  method; deferred by decision.
- Hover sync in either direction.
- URL deep-linking of the selection.
- Filters, search, sort controls, and any viewport-based filtering of the list.
- Clustering, animation, dark theme.
- Any change to `GbfsApi`, `GbfsMapper`, `VehiclePolling` or `VehicleStore`. The
  store already exposes everything this spec consumes — if it needs a change, the
  seam was wrong.
- Refactoring `poll-error.ts` onto the `NOW` token.
- Keyboard selection on the map canvas. The list is the accessible path; the
  canvas stays as SPEC 04 shipped it.

## Data model

This spec introduces no domain data. `Vehicle`, `VehicleSnapshot` and
`StoreStatus` are unchanged, and `VehicleStore` gains nothing. What it introduces
is one injection token, three pure formatters, one bucket lookup, and the
component surfaces.

### Time seam — `src/app/core/time/now.ts`

```typescript
/** Seam so relative times are exact under test. Stub it with `() => 1_700_000_000_000`. */
export const NOW = new InjectionToken<() => number>('NOW', {
  providedIn: 'root',
  factory: () => Date.now,
});
```

### Formatters — `src/app/core/format/vehicle-format.ts`

```typescript
export function formatRange(meters: number | undefined): string;
export function formatRelativeTime(epochMs: number, nowMs: number): string;
export function formatCoordinates(coordinates: {
  lat: number;
  lon: number;
}): string;
```

Conventions:

- `formatRange(undefined)` → `'no data'`. Never `'0 km'` — a missing range and
  an empty battery are different facts.
- One decimal, kilometres: `18_400` → `'18.4 km'`. Under 1 km stays in metres:
  `'340 m'`.
- `formatRelativeTime` takes `nowMs` as an argument; it never reads a clock.
  Buckets: `< 60s` → `'just now'`, then minutes, then hours. A negative delta
  (a feed clock ahead of the browser) also yields `'just now'`.
- `formatCoordinates` → `'40.71234, -73.85678'`, 5 decimals, that order.

### Bucket lookup — added to `src/app/core/map/range-buckets.ts`

```typescript
/** The bucket a range falls in, or `null` when the range is unknown. */
export function bucketFor(rangeMeters: number | undefined): RangeBucket | null;
```

`null` maps to `UNKNOWN_RANGE_COLOR`, the same grey the paint spec's default
branch uses.

### Component surfaces

`VehicleListComponent` and `VehicleDetailPanelComponent` do **not** inject
`VehicleStore`. They take signals in and emit intent out; `VehicleSidebarComponent`
is the only one wired to the store.

```typescript
// VehicleListComponent — <app-vehicle-list />
vehicles = input.required<readonly Vehicle[]>();
selected = input<Vehicle | undefined>(undefined);
select = output<string>();

// VehicleDetailPanelComponent — <app-vehicle-detail-panel />
vehicle = input.required<Vehicle>();
lost = input<boolean>(false); // store.selectionLost()
close = output<void>();

// FeedStatusBannerComponent — <app-feed-status-banner />
error = input.required<PollError>();
lastUpdated = input.required<number>();
retry = output<void>();
```

Internal state, all `signal()`, none of it derived from another signal:

| Component     | Signal                                | Role                                                                                                           |
| ------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `VehicleList` | `#activeIndex: number`                | Roving tabindex / `aria-activedescendant`. Keyboard cursor, not selection.                                     |
| `VehicleList` | `#scrollOrigin: 'self' \| 'external'` | Set to `'self'` right before emitting `select`, so the auto-scroll effect skips the row the user just clicked. |
| `App`         | `#drawerOpen: boolean`                | Mobile only. Starts `false`.                                                                                   |

Row DOM ids are `vehicle-option-${vehicle.id}`, which is what
`aria-activedescendant` points at.

## Implementation plan

Each step is independently commitable and leaves
`npm run lint && npm run build && npm test` green.

1. **Dependency and seams.** Add `@angular/cdk` to `dependencies`. Create
   `src/app/core/time/now.ts` with the `NOW` token. Add `bucketFor()` to
   `src/app/core/map/range-buckets.ts` and one test for it: a range inside each
   bucket, a range exactly on a cut point, and `undefined` → `null`. No UI yet.
   Record the initial-bundle delta from the CDK in the commit message.

2. **Formatters.** Create `src/app/core/format/vehicle-format.ts` and
   `vehicle-format.spec.ts`. Tests: metres under 1 km, one decimal above it,
   `undefined` → `'no data'`, `'just now'` under 60 s, minutes, hours, a
   negative delta, and coordinates at 5 decimals. Pure functions, no Angular in
   either file.

3. **List component, click only.** Create
   `src/app/features/vehicles/vehicle-list.component.ts`: a
   `cdk-virtual-scroll-viewport` with `itemSize="64"`, `role="listbox"`,
   `@for (v of vehicles(); track v.id)` and rows with `role="option"`,
   `aria-selected`, `aria-posinset`/`aria-setsize` — the last two are mandatory
   here, since only a window of rows is ever in the DOM. Row content: bucket dot,
   id, `formatRange`, relative `lastReported` from `NOW`. Click emits `select`.
   Nothing renders it yet; the app is unchanged.

4. **Shell layout, desktop.** Create `vehicle-sidebar.component.ts` composing the
   header (count + `lastUpdated`) and the list, wired to `VehicleStore`. Rewrite
   `app.html` as a two-region layout and `app.css` as a grid with a 380px
   sidebar; update `app.spec.ts` if the SPEC 04 assertions no longer hold.
   **Manual check:** 3,362 rows scroll at 60fps and clicking a row highlights that
   vehicle on the map — one direction of the sync is now live.

5. **Map → list.** In the list, an `effect()` on `selected()` resolves the index
   in `vehicles()` and calls `viewport.scrollToIndex(index, 'smooth')`, skipped
   when `#scrollOrigin === 'self'`. Style the selected row. Add
   `vehicle-list.component.spec.ts`: a click emits `select` with the id; an
   externally-set `selected` calls `scrollToIndex` with the right index; a
   selection the list emitted itself does not; `aria-selected` lands on exactly
   one row. **Manual check:** clicking a scooter on the map scrolls the list to it.

6. **Keyboard model.** Add roving `tabindex`, `ArrowUp`/`ArrowDown`, `Home`/`End`,
   `Enter`/`Space`, and `aria-activedescendant` on the viewport, via the `host`
   object — no `@HostListener`. Extend the spec: the listbox is one tab stop;
   `ArrowDown` moves the active row without selecting; `Enter` selects the active
   row; `End` reaches the last index.

7. **Detail panel.** Create `vehicle-detail-panel.component.ts` with the six
   fields, a `×` button and `Escape`, both emitting `close`, plus the `lost`
   notice. Render it in the sidebar above the list, bound to `store.selected()` /
   `store.selectionLost()`, with `close` calling `store.clearSelection()`. Spec:
   every field renders; `×` and `Escape` each emit `close` once; `lost` swaps the
   body for the notice and keeps the close action.

8. **No-data states.** In the sidebar, an `@switch` on `store.status()`:
   `loading` → skeleton rows, `empty` → message, `error` → message with a
   **Retry** button calling `store.refresh()`, `loaded` → panel + list. Spec:
   each status renders its branch, and the retry button calls `refresh()` exactly
   once per click.

9. **Stale-data banner.** Create
   `src/app/features/shell/feed-status-banner.component.ts` and render it in
   `app.html` only when `status() === 'loaded' && error() !== null`. It shows the
   age of `lastUpdated` and its own Retry. **Manual check:** with the network
   offline in devtools, the map keeps its vehicles and the bar appears; back
   online plus Retry clears it.

10. **Mobile drawer.** Below 768px the sidebar becomes a bottom drawer, closed on
    load, opened by a "View list (N)" button over the map, closed by `×` or
    `Escape`. `#drawerOpen` lives in `App`. **Manual check:** at 375px wide the map
    is unobstructed on load and the banner from step 9 is still visible.

11. **README.** Add the four components to the layer diagram, document the
    bidirectional sync path through `selected()`, the list as the accessible path
    to every vehicle — closing the promise SPEC 04 left open — the four UI states,
    the virtual scroll and why, and the `NOW` seam.

12. **Live verification.** With `npm start`: scroll the full list, click a map
    vehicle and watch the list scroll to it, click a row and watch the map
    highlight it, let a tick land with a selection open and confirm both survive,
    force an error and use Retry, run the whole flow keyboard-only, and run
    an AXE pass. Record observed numbers in the commit message.

## Acceptance criteria

**Build and tooling**

- [ ] `npm ci && npm run build` completes with no errors and no budget warning on
      the `initial` bundle.
- [ ] `npm run lint` passes, including the `prettier/prettier` rule.
- [ ] `npm test` passes and every test added by this spec is green.
- [ ] No `any` appears in any file added by this spec.
- [ ] No component added by this spec declares `standalone: true` or
      `changeDetection`.
- [ ] No `@HostListener` or `@HostBinding` anywhere; all host bindings live in the
      `host` object.
- [ ] No `ngClass` or `ngStyle`; only `class` and `style` bindings.

**Boundary**

- [ ] `GbfsApi`, `GbfsMapper`, `VehiclePolling` and `VehicleStore` are
      byte-identical to their state before this spec.
- [ ] `grep -rn "maplibre-gl" src` still matches exactly one file:
      `src/app/core/map/maplibre.service.ts`.
- [ ] `VehicleListComponent` and `VehicleDetailPanelComponent` do not import
      `VehicleStore`.
- [ ] `vehicle-format.ts` imports nothing from Angular, `maplibre-gl` or
      `core/state/`.
- [ ] No component reads `Date.now()` directly; the only clock in UI code is the
      `NOW` token.
- [ ] `poll-error.ts` is unchanged.

**Formatters**

- [ ] `formatRange(undefined)` returns `'no data'` and never `'0 km'`.
- [ ] `formatRange(340)` returns metres; `formatRange(18_400)` returns `'18.4 km'`.
- [ ] `formatRelativeTime` with a delta under 60 s returns `'just now'`, and a
      negative delta returns the same.
- [ ] `formatCoordinates` emits `lat, lon` at 5 decimals, in that order.
- [ ] `bucketFor(undefined)` returns `null`; a value on a bucket's lower bound
      falls in that bucket, not the previous one.

**List rendering and performance**

- [ ] The `@for` over vehicles is tracked by `vehicle.id`.
- [ ] With ~3,362 vehicles the DOM holds only the virtual-scroll window, not one
      node per vehicle — verifiable by counting `[role="option"]` elements in the
      inspector.
- [ ] Every option carries `aria-posinset` and `aria-setsize` reflecting the full
      list, not the rendered window.
- [ ] A tick that replaces the vehicle array does not reset the scroll position.
- [ ] The list holds no copy of the vehicle array and no derived signal over it.

**Bidirectional sync**

- [ ] Clicking a vehicle on the map sets `aria-selected="true"` on exactly one row
      and scrolls the viewport to it.
- [ ] Clicking a row calls `store.select(id)` and highlights that vehicle on the
      map.
- [ ] A selection originating in the list does not trigger the auto-scroll effect.
- [ ] A selection survives a tick: after ~60 s the same row is still selected and
      the map highlight is still on it.
- [ ] `store.clearSelection()` leaves no row with `aria-selected="true"` and
      nothing highlighted on the map.

**Keyboard and accessibility**

- [ ] The whole listbox is a single tab stop, whatever the vehicle count.
- [ ] `ArrowDown` / `ArrowUp` move the active row without changing the selection.
- [ ] `Home` / `End` reach the first and last vehicle in the full list, not in the
      rendered window.
- [ ] `Enter` and `Space` both select the active row.
- [ ] `aria-activedescendant` on the viewport always names an element that exists
      in the DOM.
- [ ] `Escape` closes the detail panel, and on mobile closes the drawer.
- [ ] Every vehicle in the feed is reachable and selectable using only the
      keyboard.
- [ ] An AXE pass over the running app reports no violations, with a selection
      open and with none.
- [ ] The range bucket is never communicated by colour alone: every row and the
      panel carry the range as text.

**Detail panel**

- [ ] Selecting a vehicle opens the panel with id, type, status, range,
      coordinates and relative `lastReported`.
- [ ] The `×` button and `Escape` both call `store.clearSelection()`.
- [ ] With no selection, no panel is in the DOM.
- [ ] When the selected vehicle is absent from a later snapshot, the panel stays
      open with the "no longer in the feed" notice and a working close action.
- [ ] The panel's range dot colour matches the colour that vehicle has on the map.

**States**

- [ ] Before the first snapshot the sidebar shows the loading skeleton and no
      list.
- [ ] A snapshot with zero vehicles shows the empty message, not the skeleton and
      not an empty list.
- [ ] An error before any snapshot shows the error message and a Retry
      button.
- [ ] Clicking Retry calls `store.refresh()` and, on success, replaces the
      error branch with the list.
- [ ] An error **after** a snapshot leaves the list and the map populated and
      shows the stale-data banner instead of the error branch.
- [ ] The stale-data banner is visible at 375px width with the drawer closed.
- [ ] Exactly one of the four branches is in the DOM at any time.

**Layout**

- [ ] At ≥768px the map and the 380px sidebar are both visible with no horizontal
      scrollbar.
- [ ] At <768px the drawer is closed on load and the "View list (N)" button shows
      the current vehicle count.
- [ ] Opening the drawer does not unmount the map or re-trigger `fitToData`.

**Live feed**

- [ ] With `npm start`, the list row count matches `store.vehicles().length`.
- [ ] Scrolling the full list is smooth and the browser does not warn about long
      tasks.
- [ ] The map→list and list→map paths both work against the live feed, verified
      by hand.
- [ ] No throwaway logging from step 12 remains in the committed tree.

**Documentation**

- [ ] `README.md` names `VehicleSidebarComponent`, `VehicleListComponent`,
      `VehicleDetailPanelComponent` and `FeedStatusBannerComponent` in the layer
      diagram.
- [ ] `README.md` documents the sync path through `selected()`, the virtual scroll
      and why, the four UI states, and the `NOW` seam.
- [ ] The SPEC 04 statement that the list is the accessible path is updated to say
      it now exists.

## Decisions

**List rendering**

- **Yes:** CDK virtual scroll. 3,362 rows is not a list, it is a stress test; one
  node per vehicle would undo the performance argument the map layer was built
  around. It also earns the "scale performance" bonus the README already names.
- **No:** capping the list at N vehicles. Cheaper, but it makes the list lie about
  the fleet and turns "every vehicle is reachable" — the accessibility promise
  SPEC 04 made — into a falsehood.
- **No:** filtering the list by the map viewport. It reads well and needs a
  camera-state API on `MapLibreService`, plus a `moveend` subscription: a second
  synchronisation path for a feature nobody asked for. Deferred by name.
- **Yes:** stable order by `id`. Any order over a mutable field — range,
  `lastReported` — reorders the list on every tick and moves rows out from under
  the pointer once a minute.
- **Yes:** `track vehicle.id`. Without it Angular rebuilds every row on each tick
  and the virtual scroll saves nothing.

**Sync**

- **Yes:** `store.selected()` as the only channel between map and list. Neither
  component knows the other exists; both read one signal and call one method.
  This is the requirement the challenge grades as "bidirectional", and the store
  already models it.
- **Yes:** auto-scroll on a map click. Highlighting a row 2,000 rows below the
  fold is not synchronisation the user can see.
- **Yes:** the `#scrollOrigin` guard. Without it, clicking a row scrolls the
  viewport to the row already under the pointer — a visible jump for a no-op.
- **No:** fly-to on a list click, this spec. It needs a new `MapLibreService`
  method and a camera policy that has to coexist with the one-shot `fitBounds`
  from SPEC 04. It is a bonus, not a requirement, and it belongs in a spec that
  owns the camera.
- **No:** hover sync. `mousemove` over 3,362 features plus a hover channel in the
  store, for an effect that does not exist on touch. Deferred.

**Component wiring**

- **Yes:** only `VehicleSidebarComponent` injects `VehicleStore`. List and panel
  take `input()`s and emit `output()`s, so their tests mount a component and
  nothing else.
- **No:** aligning them with `MapComponent`, which does inject the store. The map
  needs it because it bridges signals into an imperative API from an `effect()`.
  The list and the panel are presentational and the architecture note in
  `CLAUDE.md` says so.
- **Yes:** a separate `FeedStatusBannerComponent` rather than a banner inside the
  sidebar. On mobile the drawer starts closed, so a sidebar-only banner hides the
  one state the user most needs to see.

**Detail panel**

- **Yes:** inside the sidebar, above the list. One column of UI, the map stays
  unobstructed, and on mobile it does not fight the drawer for the same corner.
- **No:** a floating panel over the map. It covers data on the smallest screens,
  exactly where space is scarcest.
- **Yes:** `Escape` and `×` both close. Escape is the expected key for a transient
  panel and costs one host binding.
- **Yes:** the panel consumes `selectionLost()`. The store has modelled it since
  SPEC 03 and nothing has read it; a vehicle vanishing mid-selection is a normal
  event in a live feed, and silently closing the panel reads as a bug.
- **Yes:** range shown as text plus the bucket dot. Colour alone fails WCAG AA,
  and it is the same constant the map paints from, so the two cannot disagree.

**States**

- **Yes:** all four states in this spec. SPEC 04 deferred them to "the shell spec"
  and this is it; leaving them for later would ship a list that renders nothing
  during the first fetch with no explanation.
- **Yes:** an error **with** data on screen is a banner, not a state swap. The
  store already keeps the last snapshot on failure precisely so stale data beats
  a blank map — the UI has to honour that, or the store's design was pointless.
- **Yes:** a Retry button on `store.refresh()`. The method exists,
  resubscribing is the out-of-band tick, and waiting 60 s for the automatic retry
  with no way to ask is a bad answer to "it broke".
- **No:** a toast/snackbar system. One banner and one message branch do not
  justify an overlay service.

**Layout**

- **Yes:** a 380px sidebar at ≥768px, a bottom drawer below it, closed on load. On
  a phone the map is the product; a list opening over it on load hides what the
  user came for.
- **Yes:** the drawer button carries the vehicle count. It answers "is there
  data?" without opening anything.
- **No:** a resizable split. Ceremony inside a 4–6 hour budget.

**Time**

- **Yes:** a `NOW` token modelled on `RANDOM`. Relative times are otherwise
  untestable without freezing the machine clock, and `.claude/CLAUDE.md` forbids
  assuming globals in templates.
- **Yes:** relative text recomputed only when a tick lands. It refreshes with the
  data it describes and adds no timer. The cost is that during an outage the text
  freezes — but the banner above it is already saying the feed is stale, so the
  frozen number is not the misleading part.
- **No:** a 15 s clock signal. A second time source ticking against a component
  tree, to keep a string honest that the banner already qualifies.
- **No:** refactoring `poll-error.ts` onto `NOW`. It is a one-line improvement in
  a file this spec has no reason to touch, and touching it would put a SPEC 02
  file in this diff.

**Accessibility**

- **Yes:** `listbox`/`option` with roving tabindex. It is what "select one of N"
  means to a screen reader, and it keeps the whole list to one tab stop. A list of
  buttons would put 3,362 tab stops between the user and the footer.
- **Yes:** `aria-posinset` / `aria-setsize` on every row. With virtual scroll the
  DOM holds ~15 rows; without those attributes a screen reader announces "1 of 15"
  for a fleet of 3,362.
- **Yes:** this spec closes the promise SPEC 04 wrote into the README. The canvas
  stays non-selectable by keyboard, and the list is now the path that makes that
  acceptable.

**Testing**

- **Yes:** exhaustive tests on the formatters and `bucketFor`. Pure, fast, and the
  place where a wrong unit or an off-by-one on a bucket boundary silently
  mislabels every row.
- **Yes:** component tests asserting the sync contract — click emits, external
  selection scrolls, self-selection does not. That contract is the graded
  requirement, and it is assertable without a map.
- **No:** "component creates successfully" tests. The rubric discounts them
  explicitly.
- **Yes:** a live verification step, as in SPEC 02, 03 and 04. Virtual scroll
  behaviour under 3,362 real rows is not something jsdom can tell you about.

## Risks

| Risk                                                                                                                                                                                                                               | Mitigation                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store.selected()` is resolved against the live snapshot, so it returns a **new object identity on every tick**. An `effect()` reading it re-runs each minute and would re-scroll the viewport under a user who had scrolled away. | The auto-scroll effect keys on `selected()?.id` and keeps the last id it scrolled to; an unchanged id is a no-op. This is the single most likely way to ship a list that fights the user, so it also gets an acceptance criterion.              |
| `cdk-virtual-scroll-viewport` injects a `.cdk-virtual-scroll-content-wrapper` between the viewport and the rows, so `role="listbox"` and `role="option"` are no longer parent and child and the ARIA relationship is broken.       | The wrapper gets `role="presentation"`, which makes it transparent to the accessibility tree. Verified by the AXE pass in step 12, not by inspection — this is exactly the kind of thing that looks right and reads wrong.                      |
| Roving tabindex over a virtual list: the active row can be scrolled out of the DOM, and if DOM focus lived on the row, focus would be destroyed mid-navigation and the arrow keys would stop working.                              | DOM focus stays on the viewport permanently; the active row is communicated with `aria-activedescendant` only. No row is ever focused, so no row can lose focus by being recycled.                                                              |
| `itemSize="64"` is a promise to the viewport that every row is exactly 64px. A long vehicle id wrapping to two lines at a narrow width silently desynchronises scroll position from content.                                       | The row height is fixed in CSS and the id truncates with an ellipsis rather than wrapping. Checked at 375px during the live verification.                                                                                                       |
| Two `Escape` handlers — the detail panel and the mobile drawer — both fire on one key press, closing both at once.                                                                                                                 | Precedence is explicit: the panel handles `Escape` when a selection exists and stops propagation; the drawer only sees the key when no panel is open. Written into step 10 and asserted in the panel spec.                                      |
| The list re-diffs ~3,362 tracked identities on every tick, even though only ~15 rows are rendered. Virtual scroll bounds the DOM, not the diff.                                                                                    | Accepted at this scale: one O(n) diff over 3,362 primitives per minute is not measurable next to the `setData()` the map already does on the same tick. Named here so it is not rediscovered as a surprise if the fleet grows tenfold.          |
| `@angular/cdk` lands in the initial bundle, which is the budget that protects the hard `ng build` gate.                                                                                                                            | Step 1 adds the dependency alone and records the bundle delta in its commit message, so the cost is attributed to the step that caused it. Only `ScrollingModule` is imported; the rest of the CDK is never referenced and is tree-shaken.      |
| The mobile drawer changes the visible area around the map canvas. A map whose container is resized without `map.resize()` renders stretched.                                                                                       | The drawer is an overlay: it covers the map instead of resizing its container, so the canvas dimensions never change and no new `MapLibreService` method is needed. A push-style layout would need one, which is a reason not to build it here. |
| A selected vehicle can vanish from the feed while the panel is open, leaving `selected()` undefined and `selectionLost()` true — a state nothing in the app has ever rendered.                                                     | The panel renders the notice branch and keeps its close action. It is the only consumer of `selectionLost()`, and it has an acceptance criterion because it cannot be reproduced on demand against a live feed.                                 |

## What is **not** in this spec

- Fly-to / any camera movement on list selection.
- Hover sync in either direction.
- URL deep-linking of the selection.
- Filters, search, sort controls, viewport-based filtering of the list.
- Clustering, movement animation between ticks, dark theme.
- Keyboard selection on the map canvas.
- Any change to `GbfsApi`, `GbfsMapper`, `VehiclePolling` or `VehicleStore`.
- Refactoring `poll-error.ts` onto the `NOW` token.

Each one of those, if it lands, goes in its own spec.

## Implementation notes

Two things shipped differently from the text above. Both were decided during
implementation and are recorded here so the spec matches the code.

**`*cdkVirtualFor`, not `@for`.** The plan asked for
`@for (v of vehicles(); track v.id)` inside the viewport. CDK 22 only virtualises
through the `*cdkVirtualFor` directive: a native `@for` inside a
`cdk-virtual-scroll-viewport` renders every row, which contradicts the
performance criteria this step exists for. The list uses
`*cdkVirtualFor` with `cdkVirtualForTrackBy`, so tracking by `vehicle.id` is
preserved and the DOM holds only the window.

**The panel's `lost` branch needed a remembered vehicle.** The declared surface
is `vehicle = input.required<Vehicle>()`, but `selectionLost()` is true exactly
when `store.selected()` is `undefined`, and the store does not expose the
selected id — so there was nothing to pass in, and nothing to name. The sidebar,
the component that is wired to the store, keeps the last non-empty selection and
feeds it to the panel while the selection is lost. The panel's surface is
unchanged.
