# SPEC 04 — Map rendering with MapLibre

> **Status:** Approved
> **Depends on:** SPEC 01, SPEC 02, SPEC 03
> **Date:** 2026-07-30
> **Objective:** Render `VehicleStore.vehicles()` on a MapLibre map behind `MapLibreService` — the only importer of `maplibre-gl` — as one GeoJSON source updated with `setData()` per tick, coloured by battery range in the layer paint spec, with a click on a vehicle calling `store.select(id)`.

## Scope

**In:**

- `maplibre-gl` added to `dependencies`, loaded through `await import('maplibre-gl')`
  inside `MapLibreService` so it lands in a lazy chunk and the production budgets
  in `angular.json` stay untouched.
- `MapLibreService`, a `@Service` singleton in `src/app/core/map/maplibre.service.ts`:
  the only file in the repo that names `maplibre-gl`. It owns the map instance,
  the source, the two layers and the click handler.
- `toFeatureCollection(vehicles)` in `src/app/core/map/vehicle-geojson.ts` — a
  pure function translating `readonly Vehicle[]` into a GeoJSON
  `FeatureCollection`, plus `vehicle-geojson.spec.ts`.
- `MapComponent` in `src/app/features/map/map.component.ts`, inline template, a
  single container `<div>`. It creates the map on init, pushes `store.vehicles()`
  and `store.selected()` into the service from `effect()`s, and turns a map click
  into `store.select(id)`.
- Basemap: CARTO Positron vector style, no API key, with `AttributionControl`
  visible and `NavigationControl` for zoom.
- One GeoJSON source `vehicles`, created once. Every tick is a single `setData()`
  call. No markers, ever.
- Colour by `currentRangeMeters` in the layer paint spec: a `step` expression with
  four buckets and a neutral grey for a missing value.
- Selection rendered by a second layer `vehicles-selected`, updated with
  `setFilter` on the selected id. The source is not touched by a selection change.
- Camera: a constant initial centre and zoom over the feed's Queens/Bronx bounds,
  plus exactly one `fitBounds` after the first non-empty snapshot. Later ticks
  never move the camera.
- A `MapLegend` component in `src/app/features/map/map-legend.component.ts`,
  rendered over the map, listing the four range buckets and the "unknown range"
  grey.
- The buckets live in one module-level constant in
  `src/app/core/map/range-buckets.ts`. The layer paint spec and the legend are
  both derived from it, so a colour cannot drift between the map and its key.
- `app.html` reduced to the full-screen map, `app.css` sized to `100dvh`,
  `app.spec.ts` rewritten so it no longer asserts the scaffold `h1`.
- `maplibre-gl/dist/maplibre-gl.css` imported from `src/styles.css`.
- `map.component.spec.ts` against a `MapLibreService` double: the source is
  created once across N ticks, `setData` runs once per tick, a feature click calls
  `store.select(id)`.
- A `README.md` update: `MapLibreService` and `MapComponent` in the layer diagram,
  the colour encoding, the basemap attribution, and the statement that the map
  canvas is not keyboard-selectable and the accessible path is the list, which
  arrives in a later spec.

**Out of scope (for future specs):**

- Loading, error and empty overlays. This spec renders a map that stays blank
  until the first snapshot lands.
- The vehicle list, the detail panel, hover sync, fly-to, URL deep-linking.
- Filters, clustering, and any animation or interpolation of vehicle movement
  between ticks.
- Keyboard selection on the canvas, and popups or tooltips on the map.
- Dark theme.
- A production tile/basemap key and any deploy work.
- Any change to `GbfsApi`, `GbfsMapper`, `VehiclePolling` or `VehicleStore`. If
  this spec needs one, the seam was wrong.

## Data model

This spec introduces no domain data. `Vehicle` and `VehicleSnapshot` from SPEC 01
stay untouched. What it introduces is the projection of `Vehicle` into GeoJSON and
the one constant that both the paint spec and the legend read.

### Range buckets — `src/app/core/map/range-buckets.ts`

```typescript
export interface RangeBucket {
  /** Lower bound, inclusive, in metres. The first bucket starts at 0. */
  fromMeters: number;
  color: string;
  label: string;
}

/** Cut points chosen against the live feed: median ~19 km, max ~39 km. */
export const RANGE_BUCKETS: readonly RangeBucket[] = [...];

/** Vehicles whose `currentRangeMeters` is absent. Never a bucket colour. */
export const UNKNOWN_RANGE_COLOR = '#9ca3af';
```

Four buckets, at `0`, `5000`, `15000` and `25000` metres — under 5 km, 5–15,
15–25, over 25. The median sits inside the third bucket, so no single colour
swallows the map.

### GeoJSON projection — `src/app/core/map/vehicle-geojson.ts`

```typescript
export interface VehicleFeatureProperties {
  id: string;
  rangeMeters: number; // -1 when the vehicle has no reported range
}

export function toFeatureCollection(
  vehicles: readonly Vehicle[]
): FeatureCollection<Point, VehicleFeatureProperties>;
```

Conventions:

- Coordinates are `[lon, lat]` — GeoJSON order, the reverse of the domain model's
  `{ lat, lon }`. This is the single place where the two orders meet.
- `rangeMeters` is `-1` when `currentRangeMeters` is `undefined`. A `step`
  expression cannot branch on a missing property, so the sentinel is what makes
  `UNKNOWN_RANGE_COLOR` reachable from the paint spec. `-1` is unreachable as a
  real range.
- `id` is written both to `feature.id` and to `properties.id`. MapLibre needs the
  former for feature identity; the click handler reads the latter, which survives
  tile encoding.
- Order is preserved from the input array. The function is pure and allocates a
  new collection per call.

### Layer paint — built in `MapLibreService`

Two layers over one source named `vehicles`:

| Layer               | Filter                        | Role                                                     |
| ------------------- | ----------------------------- | -------------------------------------------------------- |
| `vehicles`          | none                          | Every vehicle, `circle-color` from the `step` expression |
| `vehicles-selected` | `['==', ['get', 'id'], <id>]` | The selected vehicle: larger radius and a stroke halo    |

`vehicles-selected` is created once with a filter that matches nothing. Selecting
sets the filter; clearing resets it to the never-matching one. No `setData` is
involved in a selection change.

The `circle-color` expression is generated from `RANGE_BUCKETS`, not hand-written:

```typescript
['step', ['get', 'rangeMeters'], UNKNOWN_RANGE_COLOR, 0, <bucket 0>, 5000, <bucket 1>, ...]
```

The `-1` sentinel falls below the first stop, so it lands on the default branch,
which is the grey.

### Service surface — `src/app/core/map/maplibre.service.ts`

```typescript
create(container: HTMLElement): Promise<void>;  // resolves after 'load', source + layers built
setVehicles(collection: FeatureCollection<Point, VehicleFeatureProperties>): void;
setSelected(id: string | null): void;
fitToData(collection: FeatureCollection<Point, VehicleFeatureProperties>): void;
onVehicleClick(handler: (id: string) => void): void;
destroy(): void;
```

Every method except `create` is a no-op before the map has loaded, so the
component never has to await anything but `create`.

## Implementation plan

Each step is independently commitable and leaves
`npm run lint && npm run build && npm test` green.

1. **Dependency and stylesheet.** Add `maplibre-gl` to `dependencies` and import
   `maplibre-gl/dist/maplibre-gl.css` from `src/styles.css`. Nothing imports the
   library from TypeScript yet. Run `npm run build` and record the initial bundle
   size in the commit message: this is the baseline the lazy chunk is measured
   against, and the point where a static import would have broken the budget.

2. **Buckets and projection.** Create `src/app/core/map/range-buckets.ts` with
   `RangeBucket`, `RANGE_BUCKETS` and `UNKNOWN_RANGE_COLOR`, and
   `src/app/core/map/vehicle-geojson.ts` with `toFeatureCollection`. Add
   `vehicle-geojson.spec.ts`. Tests: coordinates come out as `[lon, lat]`; `id`
   appears on both `feature.id` and `properties.id`; a vehicle without
   `currentRangeMeters` yields `rangeMeters: -1`; an empty input yields a
   `FeatureCollection` with an empty `features` array; input order is preserved;
   the input array is not mutated. Pure functions only — no Angular, no map.

3. **Service skeleton.** Create `src/app/core/map/maplibre.service.ts` as a
   `@Service` singleton. `create(container)` does the
   `await import('maplibre-gl')`, builds the map against the CARTO Positron
   style, adds `NavigationControl` and `AttributionControl`, and resolves on the
   `load` event. `destroy()` removes the map and clears the instance. No source,
   no layers, no data. The file is the only one in the repo matching
   `from 'maplibre-gl'` — assert that with a grep in the commit message.

4. **Component and shell.** Create `src/app/features/map/map.component.ts` with an
   inline template holding one container `<div>`. It calls `create()` on init and
   `destroy()` on teardown. Replace `app.html` with `<app-map />`, size `app.css`
   to `100dvh`, and rewrite `app.spec.ts` so it no longer asserts the scaffold
   `h1`. `npm start` now shows a full-screen basemap over Queens with no vehicles
   on it.

5. **Source, layer and per-tick updates.** In the service, build the `vehicles`
   source and the `vehicles` circle layer inside `create()`, with `circle-color`
   generated from `RANGE_BUCKETS`. Add `setVehicles(collection)` calling
   `setData()` on the existing source, and a guard that returns early when the map
   has not loaded. In the component, an `effect()` reads `store.vehicles()`,
   projects it with `toFeatureCollection` and hands it to the service.
   Additionally, the component pushes the current collection once as soon as
   `create()` resolves, without waiting for the effect to re-run, so a snapshot
   that landed during map load is not held back until the next tick. Roughly 3,100
   coloured circles now appear and move on each tick.

6. **First fit.** Add `fitToData(collection)` to the service and call it from the
   component exactly once, on the first non-empty collection, guarded by a private
   flag. Verify by hand that panning away and waiting through a tick does not move
   the camera back.

7. **Selection.** Add the `vehicles-selected` layer, created with a
   never-matching filter, plus `setSelected(id)` and `onVehicleClick(handler)`.
   The service registers a `click` handler on the `vehicles` layer, reads
   `properties.id` from the top feature and calls the handler; it also swaps the
   cursor on `mouseenter`/`mouseleave`. The component wires the handler to
   `store.select(id)` and mirrors `store.selected()` into `setSelected` from an
   `effect()`. Add `map.component.spec.ts` against a `MapLibreService` double.
   Tests: `create` is called once and the source is never rebuilt across three
   ticks; `setVehicles` is called once per tick with the projected collection; a
   click reported by the double calls `store.select` with that id; a selection
   change calls `setSelected` and never `setVehicles`; `destroy` runs on teardown.

8. **Legend.** Add `src/app/features/map/map-legend.component.ts`, rendering
   `RANGE_BUCKETS` and the unknown-range grey as static HTML positioned over the
   map. It reads the same constant the paint spec does, takes no input and holds
   no state.

9. **README.** Add `MapLibreService`, `MapComponent` and `MapLegend` to the layer
   diagram. Document the range-based colour encoding and why it is not status,
   the lazy `import()` and the bundle numbers from step 1, the CARTO/OSM
   attribution, the one-shot `fitBounds`, and the statement that the canvas is
   not keyboard-selectable and the list is the accessible path.

10. **Live verification.** With `npm start` running: confirm the basemap renders,
    the first snapshot fits the camera to the Queens/Bronx bounds, the vehicle
    count on screen matches `store.vehicles().length`, a second tick ~60 s later
    repaints without a flash and without moving the camera, clicking a vehicle
    highlights exactly one, and the highlight survives a tick. Record the observed
    numbers in the commit message.

## Acceptance criteria

**Build and tooling**

- [ ] `npm ci && npm run build` completes with no errors and no budget warning on
      the `initial` bundle.
- [ ] `maplibre-gl` appears in a lazy chunk, not in the initial bundle.
- [ ] `npm run lint` passes, including the `prettier/prettier` rule.
- [ ] `npm test` passes and every test added by this spec is green.
- [ ] No `any` appears in any file added by this spec.

**Boundary**

- [ ] `grep -rn "maplibre-gl" src --include=*.ts` matches exactly one file:
      `src/app/core/map/maplibre.service.ts`.
- [ ] `MapComponent` holds no reference to a map, source, layer or `LngLat`
      object. Its only map vocabulary is the `MapLibreService` method names.
- [ ] `maplibre.service.ts` imports nothing from `core/state/`, `core/polling/` or
      `core/gbfs/`. It knows about GeoJSON, not about `Vehicle` or the store.
- [ ] `vehicle-geojson.ts` imports nothing from Angular or `maplibre-gl`.
- [ ] `GbfsApi`, `GbfsMapper`, `VehiclePolling` and `VehicleStore` are unchanged
      by this spec.
- [ ] No component in this spec declares `standalone: true` or `changeDetection`.

**Projection**

- [ ] `toFeatureCollection` emits coordinates as `[lon, lat]`.
- [ ] Each feature carries the vehicle id on both `feature.id` and
      `properties.id`.
- [ ] A vehicle without `currentRangeMeters` yields `rangeMeters: -1`.
- [ ] An empty input yields a `FeatureCollection` whose `features` is empty.
- [ ] The input array is not mutated and feature order matches input order.
- [ ] Every colour in the `circle-color` expression comes from `RANGE_BUCKETS`;
      no colour literal appears in `maplibre.service.ts` other than through that
      constant and `UNKNOWN_RANGE_COLOR`.

**Rendering and performance**

- [ ] The `vehicles` source and both layers are created exactly once, inside
      `create()`.
- [ ] Across three consecutive ticks, the double records three `setVehicles`
      calls and zero source or layer rebuilds.
- [ ] No `Marker` is constructed anywhere in the codebase.
- [ ] `setVehicles`, `setSelected` and `fitToData` called before the map has
      loaded are no-ops and throw nothing.
- [ ] A snapshot that arrives while `create()` is still pending is rendered as
      soon as the map loads, without waiting for the next tick.
- [ ] The component holds no copy of the vehicle array; it projects
      `store.vehicles()` on each effect run and keeps no local derived signal.

**Selection**

- [ ] A click on a vehicle feature calls `store.select(id)` with the id from
      `properties.id`.
- [ ] A selection change calls `setSelected` and does not call `setVehicles`.
- [ ] `setSelected(null)` leaves the `vehicles-selected` layer matching no
      feature.
- [ ] The `vehicles-selected` layer is created with a filter matching nothing, so
      nothing is highlighted before a selection exists.
- [ ] The cursor changes over a vehicle feature and reverts on leaving it.

**Camera**

- [ ] The map opens on the constant centre and zoom, before any snapshot.
- [ ] `fitToData` runs on the first non-empty collection and on no later one.
- [ ] An empty first snapshot does not trigger a fit, and the first non-empty one
      after it does.

**Legend**

- [ ] `MapLegend` renders one entry per `RANGE_BUCKET` plus the unknown-range
      entry.
- [ ] Adding a bucket to `RANGE_BUCKETS` changes both the legend and the paint
      spec with no other edit.

**Accessibility**

- [ ] An AXE pass over the running app reports no violations.
- [ ] The `NavigationControl` buttons are reachable and operable by keyboard.
- [ ] Basemap attribution is visible on screen.
- [ ] The legend is readable text, not colour alone: every entry carries its
      range label.

**Live feed**

- [ ] With `npm start`, the basemap renders and roughly 3,100 circles appear on
      the first snapshot.
- [ ] The count of rendered features matches `store.vehicles().length`.
- [ ] A second tick ~60 s later repaints with no visible flash and without moving
      the camera.
- [ ] Panning away and waiting through a tick leaves the camera where the user
      left it.
- [ ] Clicking a vehicle highlights exactly one, and the highlight survives the
      next tick.
- [ ] No throwaway logging from step 10 remains in the committed tree.

**Documentation**

- [ ] The layer diagram in `README.md` names `MapLibreService`, `MapComponent`
      and `MapLegend`.
- [ ] `README.md` documents the range-based colour encoding and why status is not
      used, the lazy `import()` with the measured bundle numbers, the CARTO/OSM
      attribution, and the one-shot `fitBounds`.
- [ ] `README.md` states that the map canvas is not keyboard-selectable and that
      the accessible path is the vehicle list, arriving in a later spec.

## Decisions

**Loading the library**

- **Yes:** `await import('maplibre-gl')` inside `MapLibreService`. The bundle is
  ~900 kB unminified and `angular.json` errors the `initial` budget at 1 MB — a
  failing `ng build` scores zero. The lazy chunk keeps the gate intact and the
  initialisation was asynchronous anyway, since nothing may touch a source before
  the `load` event.
- **No:** a static import plus a raised budget. It reads better and relaxes the
  one limit that protects the hard gate, in exchange for nothing measurable.
- **Yes:** the dynamic import lives in the service, not in a lazy route. There is
  one route and it is the map; routing around it would be ceremony.

**Basemap**

- **Yes:** CARTO Positron vector tiles. No API key, so no secret in the bundle
  and no second proxy rule; the light grey palette lets 3,100 coloured circles
  carry the visual weight. Attribution is a licence obligation, so the control is
  in scope, not decoration.
- **No:** MapLibre demotiles. Free and keyless, but at street zoom over Queens
  the map is empty — the vehicles would float on nothing.
- **No:** MapTiler or Stadia. Better cartography, at the cost of a key that has to
  live somewhere and be rotated. Not worth it inside a 4–6 hour budget.

**Rendering strategy**

- **Yes:** one GeoJSON source and `setData()` per tick. This is the performance
  decision the whole architecture was arranged around, already written into
  `README.md` constraint 5 before any map code existed.
- **No:** one `Marker` per vehicle. It is the common trap with live feeds: 3,100
  DOM nodes recreated every 60 s, and the reason the constraint is stated as an
  absolute.
- **Yes:** the source and both layers built once inside `create()`. A rebuild path
  is the failure mode an acceptance criterion has to forbid explicitly, because it
  looks correct on screen and only shows up as jank.

**Colour encoding**

- **Yes:** colour by `currentRangeMeters`. Every vehicle in the live feed is
  `available`, non-reserved, non-disabled and a scooter, so colouring by status
  yields one colour. Range is the only field with real variance.
- **Yes:** a `step` expression with four buckets rather than a continuous
  `interpolate`. Discrete reads better across 3,100 overlapping points, it makes
  an honest legend possible, and it turns "the colour is right" into a boolean
  test.
- **Yes:** the buckets in one exported constant that generates both the paint
  expression and the legend. A map whose key lies is worse than a map with no
  key, and this makes drift impossible rather than unlikely.
- **Yes:** the `-1` sentinel for a missing range. A `step` expression cannot
  branch on an absent property, so without it the grey fallback would be
  unreachable. The live feed always sends the field, but the domain model types it
  optional and the mapper is written for other providers.

**Selection**

- **Yes:** a second layer filtered by id. One `setFilter` per selection change,
  the source untouched, and no repaint of 3,100 features to highlight one.
- **No:** `feature-state` with `promoteId`. More idiomatic MapLibre, but feature
  state is keyed to the loaded features and would need re-applying after every
  `setData` — a second synchronisation path for a visual effect.
- **No:** re-projecting the collection with a `selected` property on each
  selection. It couples selection to the data path and makes a click cost a full
  `setData`.
- **Yes:** the click handler reads `properties.id`, not `feature.id`. Both are
  written; the property survives tile encoding, the identity does not always.

**Camera**

- **Yes:** a constant centre and zoom for the first paint, then exactly one
  `fitBounds` on the first non-empty snapshot. The constant means the map is
  never staring at null island while loading; the fit means the data decides the
  frame rather than a hardcoded guess.
- **No:** fitting on every tick. It would yank the viewport out from under anyone
  who panned, once a minute, forever.
- **No:** a hardcoded bounding box for Queens/Bronx. It bakes today's provider
  and city into the UI layer, which is exactly what the mapper boundary exists to
  prevent.

**Component and service split**

- **Yes:** the service speaks GeoJSON and knows nothing about `Vehicle` or the
  store. It stays a wrapper around a map, testable and replaceable, and the
  domain-to-GeoJSON translation stays a pure function.
- **No:** injecting `VehicleStore` into `MapLibreService` and subscribing there.
  Fewer lines in the component, and it inverts the layering: the map would pull
  state instead of being driven by it, and every map test would need a store.
- **Yes:** `effect()` in the component as the bridge from signals to imperative
  calls. This is the one place in the app where a signal has to become a side
  effect; it is contained in a component that owns exactly that job.

**Testing**

- **Yes:** exhaustive tests on the pure projection. It is where an off-by-one in
  coordinate order or a missing sentinel silently produces a blank or wrong map,
  and it runs in jsdom in milliseconds.
- **Yes:** `MapComponent` tested against a `MapLibreService` double. The
  assertions that matter — source built once, one `setData` per tick, click
  selects — are about call sequences, which a double records exactly.
- **No:** `vi.mock('maplibre-gl')` to test the service itself. jsdom has no WebGL,
  so the mock would have to impersonate the map's whole lifecycle; the test would
  assert that the mock was called the way the mock was written.
- **Yes:** a live verification step, as in SPEC 02 and SPEC 03. Every automated
  test here runs against a double, so without one real run the entire rendering
  path could be broken with everything green.

**Accessibility**

- **Yes:** shipping a canvas that is not keyboard-selectable, and saying so in
  `README.md`. The accessible path to every vehicle is the list, and the list has
  its own spec. Claiming otherwise would be worse than the gap.
- **Yes:** `NavigationControl` for keyboard-operable zoom, and a legend whose
  entries carry range labels. Colour alone is not an encoding under WCAG AA.

## Risks

| Risk                                                                                                                                                                                                          | Mitigation                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The first snapshot can land while `create()` is still awaiting the dynamic import and the `load` event. The `setVehicles` guard makes it a no-op, and the next tick is ~60 s away — a blank map for a minute. | The component pushes the current `store.vehicles()` once, immediately after `create()` resolves, instead of waiting for the effect to re-run. Written into step 5 and asserted under "Rendering and performance".              |
| CARTO tiles are a third-party runtime dependency: an outage, a rate limit or an offline machine leaves the basemap blank.                                                                                     | The vehicles are a separate layer over the style and still render on a blank background. Documented in `README.md` alongside the attribution.                                                                                  |
| The lazy chunk or the style fetch can fail. `create()` rejects and this spec ships no error UI, so the failure is silent.                                                                                     | Accepted and recorded: the rejection is caught and logged, and the map error state belongs to the UI shell spec that owns loading, error and empty. Named there rather than left to be rediscovered.                           |
| `maplibre-gl.css` is a global stylesheet, so it counts against the `initial` budget even though the JS is lazy.                                                                                               | Step 1 measures the bundle before any TypeScript imports the library, so the stylesheet cost is isolated and recorded in the commit message. If it pushes past the 500 kB warning, that is visible at the step that caused it. |
| A `TestBed` that injects the real `MapLibreService` would trigger the dynamic import inside jsdom, which has no WebGL.                                                                                        | `map.component.spec.ts` overrides the provider with the double. The real service is never constructed in a test, which is also why it has no unit test of its own.                                                             |
| `setData()` re-parses and re-uploads all ~3,100 features every tick. At ten times the fleet size this becomes the bottleneck the architecture was supposed to avoid.                                          | Accepted at this scale: it is one call per minute against a feed that is measured, not guessed. Clustering and diffing are already out of scope and named as bonus territory in `README.md`.                                   |
| Nothing in CI renders the map, so the whole rendering path can break with every test green.                                                                                                                   | The live verification in step 10 is an acceptance criterion, not a suggestion, and it checks the feature count against `store.vehicles().length` rather than trusting the picture.                                             |
| The `-1` sentinel is a magic number crossing a module boundary: a future provider reporting a negative range would silently paint grey.                                                                       | The sentinel is defined and commented next to `VehicleFeatureProperties`, and a negative physical range is not representable. A mapper that ever emits one would be the bug.                                                   |

## What is **not** in this spec

- Loading, error and empty overlays.
- The vehicle list, the detail panel, hover sync, fly-to, URL deep-linking.
- Filters, clustering, and animation of vehicle movement between ticks.
- Keyboard selection on the canvas, popups and tooltips.
- Dark theme.
- A production tile/basemap key and any deploy work.
- Any change to `GbfsApi`, `GbfsMapper`, `VehiclePolling` or `VehicleStore`.

Each one of those, if it lands, goes in its own spec.
