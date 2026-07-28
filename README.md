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

## Architecture

The application is organized in strict layers. Data flows in one direction:
**feed → adapter → state → UI**, and the map is fully encapsulated behind a
service. These are non-negotiable design constraints, not aspirations.

```
GBFS feed (HTTP)
      │
      ▼
GbfsApiService ......... HTTP only. Fetches raw feed payloads.
      │
      ▼
GbfsMapper ............. Translates raw GBFS schema → Vehicle domain model.
      │                  Absorbs version/provider differences and optional fields.
      ▼
VehicleStore (Signals) . Single source of truth: vehicles(), selected(),
      │                  loading(), error(). All state lives here.
      ▼
UI components (OnPush) . Read-only consumers of signals. No imperative logic.
                         MapComponent · VehicleListComponent · DetailPanel

MapLibreService ........ The ONLY code that imports maplibre-gl. Wraps the map
                         instance; exposes add/update GeoJSON source methods.
```

### Architecture constraints

**1. Layered separation**

- `GbfsApiService` performs HTTP only and never leaks raw GBFS types past the adapter.
- `GbfsMapper` is the single translation boundary between the feed schema and the domain.
- `VehicleStore` is the single source of truth; UI never holds derived state locally.
- UI components are presentational: they read signals and emit intent, nothing more.

**2. Data isolation**

- The `Vehicle` domain model is the contract every consumer depends on.
- No GBFS-specific type crosses the mapper boundary.
- Swapping providers (or GBFS versions) touches only `GbfsApiService` + `GbfsMapper`.

**3. Map encapsulation**

- `maplibre-gl` is imported in exactly one place: `MapLibreService`.
- Presentation components never touch the map imperatively; they go through the service.

**4. Reactive by default**

- `OnPush` change detection on every component. It is the default in Angular v22,
  so it is never declared explicitly via `changeDetection:`.
- Signals for state; `computed()` for derived state (filters, counts).
- No manual subscriptions in components; the polling stream feeds the store.
- Polling uses `timer()` + `switchMap` with retry and exponential backoff.

**5. Map performance**

- Vehicles render as a single GeoJSON source; updates call `setData()` only.
- Sources, layers and markers are created once — never recreated per tick.
- Marker color derives from vehicle state inside the layer paint spec, not in components.

### Domain model

```typescript
export interface Vehicle {
  id: string;
  coordinates: { lat: number; lon: number };
  status: 'available' | 'reserved' | 'disabled';
  vehicleTypeId?: string;
  vehicleType?: string;
  currentRangeMeters?: number;
  isReserved: boolean;
  isDisabled: boolean;
  lastReported?: number;
  stationId?: string;
}
```

`stationId` is unused by the current dockless feed and exists precisely to absorb
a station-based provider without changing the contract. `currentRangeMeters` and
`vehicleType` are optional because they are provider extensions, not guaranteed
by the spec.

## Real-time updates

The feed is polled on an interval aligned with the GBFS `ttl` (60s). Each tick
fetches the latest payload, maps it to `Vehicle[]`, and pushes it into the store,
which in turn triggers a single `setData()` call on the map source. Errors are
caught by the polling stream, surfaced through `error()` in the store, and
retried with backoff without tearing down the map.

## Testing

Tests target the logic that matters, using **Vitest**:

- **`GbfsMapper`** — schema-to-domain translation, including optional-field and
  cross-version variations.
- **`PollingService`** — retry, backoff, and cancellation behavior.
- **`VehicleStore`** — state transitions (loading → loaded → empty → error, selection).

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

## Known limitations and improvements

- **CORS / production deploy.** The feed sends no `Access-Control-Allow-Origin`,
  so the dev proxy has no equivalent in a static production build. A real deploy
  needs a small serverless function or reverse proxy in front of the feed.
- **Uniform vehicle state.** The live feed reports every vehicle as available,
  non-reserved and non-disabled. Reserved/disabled rendering paths are therefore
  implemented and unit-tested against synthetic payloads rather than observed
  live.
- **Single city, single provider.** The mapper is written for arbitrary GBFS
  shapes, but only Lime New York is wired up. Adding Citi Bike's station-based
  feeds (`station_status` + `station_information`, joined on `station_id`) is the
  natural next step and would exercise the adapter boundary for real.
- **No clustering yet.** ~3,100 points render acceptably as a single GeoJSON
  source; a denser feed would want MapLibre's built-in clustering.
- **No E2E tests or CI.** Unit tests cover the mapper, polling and store; a
  Playwright smoke test and a lint/build/test pipeline are the obvious additions.

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
- Basemap tiles: attribution is rendered in the map's attribution control as
  required by the tile provider's terms.
- See `LICENSE` for this project's license.
