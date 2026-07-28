# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Angular/TypeScript coding rules live in `.claude/CLAUDE.md` and are loaded automatically. Agent process rules and the review trail live in `AGENTS.md`. This file covers commands, repo state, and architecture.

## What this repo is

A submission for a graded frontend challenge (`~/Desktop/MapVX/desafio-frontend-gbfs.pdf`). **The PDF is the authoritative spec**; `README.md` is the design contract derived from it. Both outrank inference from the code.

Budget is 4–6 effective hours, and any overrun must be declared in `README.md`.

### Hard gates (failing one is not a deduction — it is disqualifying or near-fatal)

- `npm ci && ng build` must pass, or the submission scores **0**.
- **Code and commit messages in English**, whatever language the conversation uses.
- AI usage declared in `README.md` **and** `AGENTS.md`/`CLAUDE.md`.
- Real, incremental git history. The initial commit is the untouched Angular CLI scaffold — that is required, not a smell — but a single "dump" commit is heavily penalised.

### Scoring weights (100 pts)

| #   | Criterion                          | Pts    |
| --- | ---------------------------------- | ------ |
| 1   | Architecture and solution design   | **20** |
| 2   | Modern Angular / reactive approach | 15     |
| 3   | Real-time and performance          | 15     |
| 4   | Functional requirements            | 12     |
| 5   | Code quality and structure         | 10     |
| 6   | Visual design / UX                 | 8      |
| 7   | Testing                            | 8      |
| 8   | README and documentation           | 6      |
| 9   | Git / commits                      | 3      |
| 10  | AI transparency                    | 2      |
| 11  | Licensing and attribution          | 1      |

Bonuses stack up to +25, capped at 100 total, and only count if the base area is solid: clustering +5, filters +4, advanced sync (bidirectional hover/selection, fly-to, URL deep-link) +4, animations +3, multi-provider schema handling +3, E2E/CI +3, scale performance (virtual scroll, web worker) +2, a11y +2, live deploy +2.

The four functional requirements: vehicles on the map; select one and show details; periodic updates; **bidirectional** sync between map and list/panel. Loading, error **and empty** states are all graded.

## Commands

```bash
npm start                 # ng serve → http://localhost:4200 (proxy wired in)
npm run build             # production build
npm run watch             # development build, watch mode
npm test                  # Vitest via @angular/build:unit-test
npx prettier --write .    # format (printWidth 100, single quotes)
```

There is no lint setup (no ESLint dependency or config). Prettier is the only formatter.

### Running a subset of tests

Tests run through the `@angular/build:unit-test` builder, not the `vitest` CLI, so Vitest CLI flags do not apply. Use builder options:

```bash
ng test --include src/app/core/gbfs-mapper.spec.ts   # one spec file
ng test --filter '^GbfsMapper'                        # regex on suite/test names
ng test --ui                                          # Vitest UI
ng test --browsers ChromeHeadless                     # real browser instead of jsdom
```

Default environment is Node + jsdom. `tsconfig.spec.json` pulls in `vitest/globals`, so `describe`/`it`/`expect` are ambient — do not import them.

## Current state

`src/` is still the Angular CLI scaffold: `App` root component, empty `routes`, one placeholder spec. **None of the architecture in `README.md` is implemented yet** — no `core/` layer, no `Vehicle` model, no `maplibre-gl` dependency. Treat `README.md` as the target, not a description.

`src/app/app.spec.ts` is scaffold and asserts an `h1` that disappears once real UI lands.

## The feed

|          |                                                                              |
| -------- | ---------------------------------------------------------------------------- |
| Endpoint | `https://data.lime.bike/api/partners/v2/gbfs/new_york/free_bike_status.json` |
| Via app  | `/api/gbfs/free_bike_status.json` (dev proxy)                                |
| GBFS     | 2.2, `ttl` 60s                                                               |
| Payload  | ~3,100 scooters, ~700 KB                                                     |
| Bounds   | `lat 40.666–40.911`, `lon -73.884–-73.744` — Queens/Bronx, **not Manhattan** |

Raw item shape: `bike_id`, `lat`, `lon`, `is_reserved`, `is_disabled`, `current_range_meters`, `vehicle_type_id`, `last_reported`, `vehicle_type`.

Three things that bite:

- **No CORS header on any GBFS endpoint here.** The browser cannot call the feed directly. `proxy.conf.json` is wired into the `serve` target. A static production deploy would need a serverless function or reverse proxy.
- **The brief's own endpoint is empty.** `gbfs.citibikenyc.com/gbfs/en/free_bike_status.json` returns `{"bikes": []}` — Citi Bike is dock-based; its data is in `station_status` + `station_information`. This is why the project uses Lime, documented in `README.md`. Do not silently switch back.
- **Every live vehicle is `available`, non-reserved, non-disabled, and a `scooter`.** Colouring purely by `status` produces a one-colour map and single-bucket filters. `current_range_meters` (min 0, median ~19 km, max ~39 km) is the only field with real variance.

## Target architecture

Strict one-way flow, **feed → adapter → state → UI**, with the map fully encapsulated:

```
GBFS feed (HTTP)
  → GbfsApiService    HTTP only; raw GBFS types never escape past the mapper
  → GbfsMapper        sole translation boundary; absorbs provider/version differences
  → VehicleStore      single source of truth: vehicles(), selected(), loading(), error()
  → UI components     presentational; read signals, emit intent, hold no derived state

MapLibreService       the ONLY module allowed to import `maplibre-gl`
```

Non-negotiable constraints:

- **`maplibre-gl` is imported in exactly one file** (`MapLibreService`). Components never touch the map imperatively.
- **Swapping feed provider or GBFS version must touch only `GbfsApiService` + `GbfsMapper`.** The `Vehicle` domain model is the contract everything else depends on.
- **Signals hold state; RxJS drives the stream.** The store is the seam. Polling is `timer()` + `switchMap` with retry/exponential backoff, aligned to the feed's `ttl`. No manual subscriptions in components.
- **Map updates call `setData()` on a single GeoJSON source.** Sources, layers and markers are created once, never per tick. Visual encoding lives in the layer paint spec, not in component logic.

### Testing philosophy

Test what can break: `GbfsMapper` (schema→domain, optional fields, cross-provider shapes), the polling service (retry, backoff, cancellation), and `VehicleStore` (loading → loaded → empty → error, selection). Skip "component creates successfully" tests — the rubric explicitly discounts them.

## Configuration notes

- **Zoneless.** `zone.js` is not a dependency and `angular.json` has no `polyfills` entry. Do not add zone-based patterns.
- **`strict: true` and `strictTemplates` are enabled**, along with `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns`, `noFallthroughCasesInSwitch`. Rubric criterion 5 grades strict typing and penalises gratuitous `any` — keep raw GBFS payloads typed at the mapper boundary and `unknown` before it.
- **`noPropertyAccessFromIndexSignature`** means index-signature members need bracket access — relevant when handling loosely typed feed payloads.
- **`OnPush` is the Angular v22 default.** The rubric explicitly looks for `OnPush`, and `.claude/CLAUDE.md` forbids declaring it. Both are satisfied by relying on the default and documenting it in `README.md`. Do not add `changeDetection:` to decorators.
- **Tailwind v4** via PostCSS (`.postcssrc.json`), pulled in with `@import 'tailwindcss'` in `src/styles.css`. There is no `tailwind.config.js`; configure via CSS directives.
- Static assets go in `public/` (served at root), not `src/assets/`.
