# GBFS Real-time Vehicle Visualizer

An Angular application that visualizes shared mobility vehicles from a live
[GBFS](https://github.com/MobilityData/gbfs) feed on an interactive MapLibre map,
updating in near real-time via polling.

## Stack

- **Angular 22** — standalone components, zoneless, Signals
- **MapLibre GL JS** — interactive vector map
- **RxJS** — polling stream with retry/backoff
- **Tailwind CSS** — utility-first styling
- **Vitest** — unit testing
- **GBFS feed** — Lime New York (`free_bike_status`, GBFS 2.2), with an adapter
  designed to tolerate GBFS schema differences across versions and providers

## Requirements

| Tool        | Version                                   |
| ----------- | ----------------------------------------- |
| Node.js     | 20.19+ / 22.12+ (developed on 24.17)      |
| npm         | 10+ (developed on 11.18)                  |
| Angular CLI | 22.x (`npx ng`, no global install needed) |

## Getting started

```bash
npm ci
npm start          # ng serve → http://localhost:4200
npm run build      # production build
npm test           # unit tests (Vitest)
```

The live feed does **not** send CORS headers, so a browser cannot call it
directly. `proxy.conf.json` maps `/api/gbfs/*` onto the upstream feed and is
wired into the `serve` target, so `npm start` works with no extra setup. See
[Known limitations](#known-limitations-and-improvements) for what this implies
for a production deployment.

## Data source

| Item     | Value                                                                        |
| -------- | ---------------------------------------------------------------------------- |
| Endpoint | `https://data.lime.bike/api/partners/v2/gbfs/new_york/free_bike_status.json` |
| Via app  | `/api/gbfs/free_bike_status.json` (dev proxy)                                |
| In prod  | `gbfs/free_bike_status.json` (captured snapshot — see below)                 |
| GBFS     | 2.2 · `ttl` 60s                                                              |
| Payload  | ~3,100 free-floating scooters, ~700 KB                                       |
| Coverage | Queens and the Bronx — `lat 40.666–40.911`, `lon -73.884–-73.744`            |

The challenge brief specifies the Citi Bike NYC feed
(`https://gbfs.citibikenyc.com/gbfs/en/free_bike_status.json`). That endpoint
returns `{"bikes": []}` — Citi Bike is a dock-based system with no free-floating
fleet, so `free_bike_status` is legitimately empty, and its data lives in
`station_status`/`station_information` instead. Building against it would render
an empty map and make the real-time and performance requirements untestable.
This project therefore uses Lime New York, which serves the same feed type with
live data. This deviation is deliberate and is the reason the mapper is written
against the GBFS _shape_ rather than one provider.

### The live demo replays a snapshot

Live demo: **https://fernandoespana.github.io/gbfs-visualizer/**

The feed sends no `Access-Control-Allow-Origin` header, so a browser cannot call
it directly, and GitHub Pages is static hosting with no way to proxy. The
deployed build therefore reads `public/gbfs/free_bike_status.json`, a snapshot of
the real feed captured on 2026-07-30 (3,416 vehicles). Polling, TTL scheduling,
retry and re-render all run exactly as they do against the live endpoint — the
payload simply does not change between ticks, so vehicles do not move.

The switch is a single `useFactory` on `GBFS_FEED_URL` in `app.config.ts` keyed
off `isDevMode()`; the URL is resolved against `document.baseURI` because Pages
serves the app from a repository subpath. `npm start` is unaffected and remains
fully live. Restoring live data in production means pointing that one provider at
a CORS-enabled proxy — nothing else in the app knows where the feed comes from.

## Architecture

The application is organized in strict layers. Data flows in one direction:
**feed → adapter → state → UI**, and the map is fully encapsulated behind a
service. These are non-negotiable design constraints, not aspirations.

```
GBFS feed (HTTP)
      │
      ▼
GbfsApi ................ HTTP only. Fetches raw feed payloads as `unknown`.
      │
      ▼
GbfsMapper ............. Translates raw GBFS schema → Vehicle domain model.
      │                  Absorbs version/provider differences and optional fields.
      ▼
VehiclePolling ......... Drives the two above on a ttl-aligned interval. Retry,
      │                  backoff, timeout and cancellation live here. Emits a
      │                  PollResult: a snapshot or a classified error.
      ▼
VehicleStore (Signals) . Single source of truth: status(), vehicles(),
      │                  selected(), selectionLost(), error(), lastUpdated(),
      │                  droppedCount(). All state lives here.
      ▼
UI components (OnPush) . Read-only consumers of signals. No imperative logic.
      │                  MapComponent · MapLegend · VehicleListComponent ·
      │                  DetailPanel
      ▼
MapLibreService ........ The ONLY code that imports maplibre-gl. Owns the map,
                         its GeoJSON source and its layers. Speaks GeoJSON and
                         vehicle ids; knows nothing about Vehicle or the store.
```

`MapComponent` is the one place where a signal becomes a side effect: two
`effect()`s push `vehicles()` and `selected()` into the service, and a map click
comes back as `store.select(id)`. It holds no map, source or layer object — its
entire map vocabulary is the service's method names. `toFeatureCollection()` is
a pure function and the only place where the domain's `{ lat, lon }` meets
GeoJSON's `[lon, lat]`.

### Architecture constraints

**1. Layered separation**

- `GbfsApi` performs HTTP only and returns `unknown`: the generic on `get` is a
  cast, not a check, and the payload comes from a third party.
- `GbfsMapper` is the single translation boundary between the feed schema and the domain.
- `VehiclePolling` is the only caller of `GbfsMapper`; it owns time and failure.
- `VehicleStore` is the single source of truth; UI never holds derived state locally.
- UI components are presentational: they read signals and emit intent, nothing more.

**2. Data isolation**

- The `Vehicle` domain model is the contract every consumer depends on.
- No GBFS-specific type crosses the mapper boundary.
- Swapping providers (or GBFS versions) touches only `GbfsApi` + `GbfsMapper`.

**3. Map encapsulation**

- `maplibre-gl` is imported in exactly one place: `MapLibreService`.
- Presentation components never touch the map imperatively; they go through the service.

**4. Reactive by default**

- `OnPush` change detection on every component. It is the default in Angular v22,
  so it is never declared explicitly via `changeDetection:`.
- Signals for state; `computed()` for derived state (filters, counts).
- No manual subscriptions in components; the polling stream feeds the store.
- Polling is an RxJS stream with retry and exponential backoff; see below.

**5. Map performance**

- Vehicles render as a single GeoJSON source; updates call `setData()` only.
- The source and both layers are created once, inside `create()` — never per tick.
- No `Marker` is constructed anywhere in the codebase.
- Colour derives from vehicle state inside the layer paint spec, not in components.

### Domain model

```typescript
export type VehicleStatus = 'available' | 'reserved' | 'disabled';

export interface Vehicle {
  id: string;
  coordinates: { lat: number; lon: number };
  status: VehicleStatus;
  isReserved: boolean;
  isDisabled: boolean;
  vehicleTypeId?: string;
  vehicleType?: string;
  currentRangeMeters?: number;
  lastReported?: number; // epoch milliseconds
  stationId?: string; // never populated by a free-floating feed
}

/** One fetch of the feed. `ttlMs` is what the polling interval aligns to. */
export interface VehicleSnapshot {
  vehicles: readonly Vehicle[];
  lastUpdated: number; // epoch milliseconds
  ttlMs: number;
  droppedCount: number;
}
```

`stationId` is unused by the current dockless feed and exists precisely to absorb
a station-based provider without changing the contract. `currentRangeMeters` and
`vehicleType` are optional because they are provider extensions, not guaranteed
by the spec.

**All domain timestamps are epoch milliseconds.** GBFS 2.2 sends POSIX seconds
and GBFS 3.x sends RFC3339 strings; both are normalised at the mapper boundary
so no consumer has to know which dialect produced them.

`GbfsMapper` returns a `VehicleSnapshot` rather than a bare `Vehicle[]` because
`ttl` and `last_updated` live on the raw envelope. Discarding them would force
the polling layer to re-read the raw payload and the mapper would stop being the
single translation boundary.

**The failure contract has two levels.** A malformed item — no id, a missing or
out-of-range coordinate — is dropped and tallied in `droppedCount`, so one bad
record out of thousands cannot blank the map. An unusable envelope throws
`GbfsMapperError`, because a feed fault is an error state, not an empty fleet.

## Real-time updates

The feed is polled on an interval aligned with the GBFS `ttl` (60s). Each tick
fetches the latest payload, maps it to a `VehicleSnapshot`, and pushes it into
the store, which in turn triggers a single `setData()` call on the map source.

The interval is read from the last snapshot's `ttlMs`, not hardcoded, so a
provider that changes its `ttl` cannot silently desynchronise the client. The
first tick fires immediately, and the delay is measured from tick completion
rather than tick start: a slow feed pushes the next request back instead of
stacking one on top of it.

**Failures travel as values.** `VehiclePolling` emits a `PollResult` — either a
snapshot or a classified `PollError` (`network`, `http` or `schema`). The stream
itself never errors and never completes, because an observable that errored
would end the polling at the moment retrying matters most.

| Guard        | Value                               | Why                                                                   |
| ------------ | ----------------------------------- | --------------------------------------------------------------------- |
| Timeout      | 15s per request                     | A hung connection is otherwise indistinguishable from a slow one.     |
| Retries      | 3, at 1s / 2s / 4s with ±20% jitter | The whole budget plus one timeout fits inside a single 60s `ttl`.     |
| Retry budget | Resets on every successful tick     | A session left open overnight must not exhaust it on transient blips. |
| Schema error | Never retried                       | A corrupt envelope is deterministic; retrying only delays the error.  |

The feed URL is injected through the `GBFS_FEED_URL` token, provided in
`app.config.ts`. It is deliberately factory-less: the development value goes
through the `ng serve` proxy and only works on localhost, so a production
deployment repoints that one provider rather than editing a service.

## Application state

`VehicleStore` holds four private writable signals — the snapshot, the error,
the selected id and whether the stream started — and exposes nothing but
`computed()` accessors and commands. One fact has one owner, so `status()`,
`vehicles()` and `error()` cannot contradict each other.

`status()` is derived, never assigned:

| Status      | When                                                          |
| ----------- | ------------------------------------------------------------- |
| `'idle'`    | `start()` has not been called; nothing is polling yet.        |
| `'loading'` | Started, no snapshot and no error yet.                        |
| `'loaded'`  | A snapshot arrived carrying vehicles.                         |
| `'empty'`   | A snapshot arrived carrying none — a graded state, not a bug. |
| `'error'`   | The stream failed and **no** snapshot has ever arrived.       |

**Stale data beats a blank map.** An error that arrives after a successful tick
populates `error()` and leaves `status()` and `vehicles()` untouched — the same
array instance, so no marker or list row repaints. The UI shows a banner over
the data it already has, and the next successful tick clears `error()`. Only a
failure with nothing ever loaded reaches `'error'`, because that is the one case
where there is nothing to show. `error()` is never cleared by time.

**The selection is an id, not an object.** `selected()` resolves it against the
current snapshot, so it can never age into a stale copy. A vehicle that vanishes
from the feed keeps its id and raises `selectionLost()`, letting the detail panel
say so instead of disappearing while it is being read.

**`droppedCount()` is surfaced and never escalated.** A feed with thousands of
good vehicles and a handful of malformed ones is still usable, so a non-zero
count stays `'loaded'`; the live feed drops zero, and any threshold that flipped
the store into `'error'` would be a number invented without data.

`start()` is idempotent and called once from `App`; the subscription is torn
down with `takeUntilDestroyed`. `refresh()` unsubscribes and resubscribes, which
is an immediate out-of-band tick because `snapshots$` is cold and its first tick
has no delay.

## Map rendering

### One source, one `setData()` per tick

Every vehicle lives in a single GeoJSON source named `vehicles`, created once
inside `MapLibreService.create()` together with both layers. A tick is one
`setData()` call — no markers, no layer rebuilds, no per-feature DOM. Recreating
~3,100 markers every 60s is the standard trap with live feeds, and the
constraint against it is asserted in `map.component.spec.ts` rather than left to
discipline.

### Loading the library

`maplibre-gl` is loaded with `await import('maplibre-gl')` inside the service,
so it lands in a lazy chunk:

| Bundle               | Raw       | Transfer  |
| -------------------- | --------- | --------- |
| Initial (app shell)  | 322.03 kB | 77.63 kB  |
| Lazy chunk, MapLibre | 1.04 MB   | 231.18 kB |

`angular.json` errors the `initial` budget at 1 MB. A static import would put
the initial bundle at roughly 1.3 MB and fail `ng build` outright, so the lazy
chunk protects the build itself, not just first paint. Initialisation was
asynchronous anyway: nothing may touch a source before the map's `load` event.

MapLibre is pinned to **v5**. v6 stopped bundling its tile worker and resolves
one at runtime from `new URL('./maplibre-gl-worker.mjs', import.meta.url)` — a
sibling file that exists in the published `dist` but not next to a prebundled
chunk, so under Vite and esbuild it 404s. Because MapLibre requests vector tiles
from the worker rather than the main thread, the failure is near-silent: the
style, TileJSON and sprite all load, attribution renders, the canvas is sized
and WebGL is live, and no tile is ever requested. v5 inlines the worker as a
blob URL. It ships UMD, so `maplibre-gl` is declared in
`allowedCommonJsDependencies` to keep the build free of warnings.

### Basemap

CARTO Positron vector tiles, no API key: no secret in the bundle and no second
proxy rule, and the light grey palette lets the vehicles carry the visual
weight. `AttributionControl` is mounted expanded — attribution is a licence
obligation, and the default control collapses it behind a click on narrow
screens. `NavigationControl` provides keyboard-operable zoom.

The tiles are a third-party runtime dependency: an outage, a rate limit or an
offline machine leaves the basemap blank. The vehicles are a separate layer over
the style and still render on the empty background.

### Colour encoding

Colour is keyed on `currentRangeMeters`, not on `status`. Every vehicle in the
live feed is `available`, non-reserved, non-disabled and a scooter, so colouring
by status yields a one-colour map; range is the only field with real variance
(min 0, median ~19 km, max ~39 km).

| Range     | Colour           |
| --------- | ---------------- |
| Under 5km | `#d7191c` red    |
| 5–15 km   | `#fdae61` orange |
| 15–25 km  | `#2c7bb6` blue   |
| Over 25km | `#1a9850` green  |
| Unknown   | `#9ca3af` grey   |

A discrete `step` expression rather than a continuous `interpolate`: it reads
better across thousands of overlapping points, it makes an honest legend
possible, and it turns "the colour is right" into a boolean test. The cut points
live in one exported constant, `RANGE_BUCKETS`, from which both the paint
expression and the `MapLegend` component are derived — a map whose key lies is
worse than a map with no key, and this makes drift impossible rather than
unlikely.

A vehicle with no reported range is projected as `rangeMeters: -1`. A `step`
expression cannot branch on a missing property, so without the sentinel the grey
fallback would be unreachable. The live feed always sends the field; the domain
model types it optional because the mapper is written for other providers.

### Selection

The selected vehicle is drawn by a second layer, `vehicles-selected`, created
with a filter that matches nothing and moved with one `setFilter` per selection
change. The source is never touched, so highlighting one vehicle does not
repaint the other 3,100 and the highlight survives a tick. `feature-state` with
`promoteId` is the more idiomatic MapLibre approach but would need re-applying
after every `setData` — a second synchronisation path for a visual effect.

The click handler reads `properties.id` rather than `feature.id`: both are
written, but the property survives tile encoding and the identity does not
always.

### Camera

The map opens on a constant centre and zoom over the feed's coverage, so it is
never staring at null island while loading, and performs exactly one `fitBounds`
on the first non-empty snapshot. Later ticks never move the camera: fitting on
every tick would yank the viewport away from anyone who panned, once a minute,
forever. An empty first snapshot does not spend the fit.

### Accessibility

The map canvas is **not keyboard-selectable**. Selecting a vehicle requires a
pointer. The accessible path to every vehicle is the vehicle list, which arrives
in a later spec; claiming otherwise would be worse than the gap. What is covered
today: the `NavigationControl` buttons are reachable and operable by keyboard,
the attribution is visible on screen, and every legend entry carries its range
label as text, because colour alone is not an encoding under WCAG AA.

## Testing

Tests target the logic that matters, using **Vitest**:

- **`GbfsMapper`** — schema-to-domain translation, including optional-field and
  cross-version variations.
- **`VehiclePolling`** — retry, backoff, timeout, interval and cancellation behaviour.
- **`VehicleStore`** — state transitions (idle → loading → loaded/empty/error),
  the stale-on-error rule, selection across ticks, and subscription lifecycle.
- **`toFeatureCollection`** — coordinate order, the id on both `feature.id` and
  `properties.id`, the missing-range sentinel, empty input, order preservation
  and input immutability. An off-by-one here produces a blank or wrong map
  silently.
- **`MapComponent`** — driven against a `MapLibreService` double, because the
  assertions that matter are call sequences: the map is built once across three
  ticks, one collection is pushed per tick, a click selects, a selection change
  never reaches the source, and the camera fits the first non-empty snapshot
  only.

`MapLibreService` itself has no unit test. jsdom has no WebGL, so a mocked
`maplibre-gl` would have to impersonate the map's whole lifecycle and the test
would assert that the mock was called the way the mock was written. The
rendering path is covered by a manual live verification instead, recorded in the
commit for each map step.

Trivial "component creates successfully" tests are intentionally omitted; they
add coverage numbers without protecting behavior.

```bash
npm test                                  # full suite
npx ng test --include src/app/…/x.spec.ts # a single spec
npx ng test --filter '^GbfsMapper'        # by suite/test name
```

## Decisions and trade-offs

- **Signals as the source of truth, RxJS for the stream.** Signals model
  application state ergonomically and integrate with `OnPush`; RxJS handles the
  time-based polling and error recovery it's best at. The store is the seam
  between them.
- **A dedicated `MapLibreService` wrapper.** Keeping every `maplibre-gl` call in
  one place keeps the map swappable and keeps components free of imperative map
  logic — the single biggest lever for a clean, testable UI layer.
- **An explicit adapter/mapper even for one feed.** It costs a little upfront but
  makes the provider (and GBFS version) a swappable detail rather than an
  assumption baked across the codebase. The empty Citi Bike feed described above
  is the concrete case that justifies it.
- **`setData()` over marker recreation.** Recreating markers each tick is the
  common performance trap with live map data; a single GeoJSON source updated in
  place scales to large fleets smoothly.
- **Colour keyed on more than `status`.** Every vehicle in the live feed is
  currently `available` and of type `scooter`, so colouring purely by status
  yields a single-colour map. `currentRangeMeters` is the only field with real
  variance (min 0, median ~19 km, max ~39 km), so it drives the visual encoding.
  The logic stays in the layer paint spec, honouring constraint 5.
- **A lazy `import()` rather than a raised budget.** A static import reads
  better and would relax the one limit that protects the hard `ng build` gate,
  in exchange for nothing measurable. See [Map rendering](#loading-the-library).

## Known limitations and improvements

- **CORS / production deploy.** The feed sends no `Access-Control-Allow-Origin`,
  so the dev proxy has no equivalent in a static production build. The GitHub
  Pages demo replays a captured snapshot instead of the live feed; a genuinely
  live deploy needs a small serverless function or reverse proxy in front of the
  feed.
- **Uniform vehicle state.** The live feed reports every vehicle as available,
  non-reserved and non-disabled. Reserved/disabled rendering paths are therefore
  implemented and unit-tested against synthetic payloads rather than observed
  live.
- **Single city, single provider.** The mapper is written for arbitrary GBFS
  shapes, but only Lime New York is wired up. Adding Citi Bike's station-based
  feeds (`station_status` + `station_information`, joined on `station_id`) is the
  natural next step and would exercise the adapter boundary for real.
- **The map canvas is not keyboard-accessible.** Selecting a vehicle needs a
  pointer. The vehicle list is the accessible path and arrives in a later spec.
- **No loading, error or empty overlay on the map yet.** The map stays blank
  until the first snapshot lands, and a failed style or lazy chunk is caught and
  logged rather than surfaced. Both belong to the UI shell spec that owns those
  states.
- **No clustering yet.** ~3,100 points render acceptably as a single GeoJSON
  source; a denser feed would want MapLibre's built-in clustering. `setData()`
  re-parses and re-uploads every feature each tick — one call per minute against
  a measured fleet, but the first thing to revisit at ten times the scale.
- **No E2E tests.** Unit tests cover the mapper, polling and store, and
  `.github/workflows/deploy.yml` gates every deploy on lint plus the full suite.
  A Playwright smoke test over the map and the selection round-trip is the
  obvious addition.

## Effort

<!-- Update this before submitting. The brief asks for 4–6 effective hours and
     requires declaring any overrun. -->

Effort spent: _to be filled in before submission_.

## AI usage

This project was built with AI assistance, disclosed transparently:

- **Claude Code** with a spec-driven development workflow (`/spec` to author the
  specification, `/spec-impl` to implement it step by step).
- The **Angular MCP server** was consulted for current best practices before
  writing Angular code.
- The empty-feed problem documented above was found by querying the endpoints
  directly rather than trusting the brief — an example of reviewing AI and
  upstream inputs instead of accepting them.
- Every step was reviewed against the spec and this document before committing.

See `AGENTS.md` for the detailed agent configuration and process rules.

## License & attribution

- Vehicle data from the [Lime](https://www.li.me/) public GBFS feed, used under
  their partner feed terms.
- Feed format: [GBFS](https://github.com/MobilityData/gbfs) by MobilityData.
- Map rendering: [MapLibre GL JS](https://maplibre.org/) — BSD-3-Clause.
- Basemap tiles: **© [CARTO](https://carto.com/attributions), ©
  [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors** —
  CARTO Positron, ODbL. Rendered on screen in the map's attribution control, as
  the tile terms require.
- See `LICENSE` for this project's license.
