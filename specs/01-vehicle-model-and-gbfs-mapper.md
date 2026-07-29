# SPEC 01 — Vehicle domain model and GbfsMapper

> **Status:** Approved
> **Depends on:** —
> **Date:** 2026-07-29
> **Objective:** Define the `Vehicle` domain model and a `GbfsMapper` service that translates raw GBFS 2.2 and 3.x free-floating payloads into it, so that every other layer depends on the domain contract instead of the feed schema.

## Scope

**In:**

- The `Vehicle` domain interface, the `VehicleStatus` union and the `VehicleSnapshot` envelope, in `src/app/core/models/vehicle.model.ts`.
- Raw GBFS payload types for `free_bike_status` (2.2) and `vehicle_status` (3.x), in `src/app/core/gbfs/gbfs.types.ts`. These types never leave that file's directory.
- `GbfsMapper`, a `@Service`-decorated singleton in `src/app/core/gbfs/gbfs-mapper.ts`, exposing a single entry point that takes `unknown` and returns a `VehicleSnapshot`.
- Hand-written type guards inside the mapper: no schema-validation dependency is added.
- Normalisation of the two GBFS dialects: `data.bikes` or `data.vehicles`, `bike_id` or `vehicle_id`, POSIX-seconds integers or RFC3339 strings for timestamps.
- Per-item validation: malformed entries are dropped and counted in `VehicleSnapshot.droppedCount`.
- Unit tests in `src/app/core/gbfs/gbfs-mapper.spec.ts`, driven by a committed real Lime fixture plus synthetic payloads.
- A committed fixture of ~15 real items from the live Lime feed, in `src/app/core/gbfs/__fixtures__/`.
- Correcting the `Vehicle` block in `README.md` so the documented model matches the one shipped (millisecond timestamps, `VehicleSnapshot`, `droppedCount`).

**Out of scope (for future specs):**

- `GbfsApiService` and any HTTP call. The mapper is pure and never touches the network.
- `VehicleStore`, signals, polling, retry and backoff.
- Station-based providers (`station_status` + `station_information` joined on `station_id`). The `stationId` field exists on `Vehicle` as a placeholder, but no code populates it.
- Any UI, map or `maplibre-gl` work.
- The GBFS discovery document (`gbfs.json`) and multi-language feed selection.
- Filtering, sorting or grouping of vehicles. Those are derived state and belong to the store.

## Data model

### Domain — `src/app/core/models/vehicle.model.ts`

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

export interface VehicleSnapshot {
  vehicles: readonly Vehicle[];
  lastUpdated: number; // epoch milliseconds
  ttlMs: number;
  droppedCount: number;
}
```

### Raw feed — `src/app/core/gbfs/gbfs.types.ts`

Structural, not exhaustive: only the fields the mapper reads are typed. These
types are internal to `src/app/core/gbfs/` and are never imported elsewhere.

```typescript
// A single item as it arrives, covering both dialects.
interface RawVehicle {
  bike_id?: unknown; // GBFS 2.2
  vehicle_id?: unknown; // GBFS 3.x
  lat?: unknown;
  lon?: unknown;
  is_reserved?: unknown;
  is_disabled?: unknown;
  vehicle_type_id?: unknown;
  vehicle_type?: unknown; // Lime extension, not in the GBFS spec
  current_range_meters?: unknown;
  last_reported?: unknown; // number (2.2) or RFC3339 string (3.x)
}

// The envelope.
interface RawFeed {
  last_updated?: unknown; // number (2.2) or RFC3339 string (3.x)
  ttl?: unknown; // seconds
  data?: { bikes?: unknown; vehicles?: unknown };
}
```

Every field is `unknown` on purpose: the mapper narrows each one through a type
guard, so a provider sending a string where a number is expected is a dropped
item, not a runtime crash.

### Conventions

- **Timestamps.** All times are epoch **milliseconds** in the domain, whatever
  the feed sends. GBFS 2.2 sends POSIX seconds; 3.x sends RFC3339 strings.
- **TTL.** `ttlMs` is milliseconds; GBFS sends `ttl` in seconds.
- **Coordinates.** WGS84 decimal degrees, as GBFS defines them. `lat` and `lon`
  are kept as separate named fields rather than a GeoJSON `[lon, lat]` tuple —
  the tuple ordering trap belongs at the map layer, not the domain.
- **Status derivation.** `is_disabled` wins over `is_reserved`; neither means
  `available`. `isReserved` and `isDisabled` are also kept raw so a consumer can
  distinguish the combined case.
- **Bracket access.** `noPropertyAccessFromIndexSignature` is on, so narrowing an
  `unknown` payload through `Record<string, unknown>` requires `raw['lat']`.

### Failure contract

Two levels, deliberately different:

- **Item level — drop and count.** A missing/non-string id, a missing or
  non-finite `lat`/`lon`, or a coordinate outside `[-90, 90]` / `[-180, 180]`
  drops that vehicle and increments `droppedCount`. Optional fields that fail
  their guard are simply left `undefined`.
- **Envelope level — throw `GbfsMapperError`.** Payload not an object, no `data`,
  or neither `data.bikes` nor `data.vehicles` being an array. An unusable
  envelope is a feed/provider fault, not a data point, and the caller must be
  able to surface it as an error state.

Missing `last_updated` falls back to `0`; missing or non-positive `ttl` falls
back to `60000` ms, the value the Lime feed advertises. Neither is fatal.

## Implementation plan

Each step is independently commitable and leaves `npm run lint && npm run build && npm test` green.

1. **Domain model.** Create `src/app/core/models/vehicle.model.ts` with
   `VehicleStatus`, `Vehicle` and `VehicleSnapshot` exactly as specified above.
   Types only, no logic. Verify: `npm run build` passes.

2. **Real fixture.** Fetch the live Lime feed from the terminal (CORS restricts
   browsers, not `curl`), trim it to ~15 representative items, and commit it as
   `src/app/core/gbfs/__fixtures__/lime-free-bike-status.json`. Keep the envelope
   (`last_updated`, `ttl`, `data.bikes`) intact — the envelope is under test too.
   Preserve variety in `current_range_meters`, including a `0`: it is the only
   field with real variance and it later drives the map's visual encoding.
   Verify: the file parses as JSON and `data.bikes.length === 15`.

3. **Raw types.** Create `src/app/core/gbfs/gbfs.types.ts` with `RawVehicle` and
   `RawFeed`, all fields `unknown`. Not exported beyond the `gbfs/` directory.

4. **Error type and envelope parsing.** Create `src/app/core/gbfs/gbfs-mapper.ts`
   with `GbfsMapperError` and a `@Service`-decorated `GbfsMapper` whose
   `toSnapshot(raw: unknown): VehicleSnapshot` handles the envelope only: locate
   `data.bikes` or `data.vehicles`, normalise `last_updated` and `ttl`, throw on
   an unusable envelope, and return an empty `vehicles` array for now. Add the
   spec file with envelope tests: valid 2.2 envelope, valid 3.x envelope, missing
   `data`, non-array item list, missing `ttl` falling back to `60000`.

5. **Timestamp normalisation.** Add the private helper that turns POSIX seconds
   (2.2) or an RFC3339 string (3.x) into epoch milliseconds, returning
   `undefined` on anything unparseable. Numeric values above `1e11` are treated
   as already-milliseconds and passed through unscaled. Tests: integer seconds,
   a millisecond-scale integer, RFC3339 with `Z`, RFC3339 with a numeric offset,
   garbage string, `null`.

6. **Item mapping, GBFS 2.2.** Map each raw item to a `Vehicle`: `bike_id`,
   coordinates with finite-and-in-range validation, status derivation
   (`is_disabled` over `is_reserved`), and the optional fields. Drop invalid
   items and increment `droppedCount`. Tests run against the committed Lime
   fixture and assert the full mapped shape of one known item.

7. **Item mapping, GBFS 3.x.** Accept `vehicle_id` as an alias for `bike_id` and
   RFC3339 `last_reported`. Tests use a synthetic 3.x payload covering the same
   items so both dialects produce identical `Vehicle` objects.

8. **Edge-case tests.** Synthetic payloads the live feed never produces:
   `is_reserved: true`, `is_disabled: true`, both true at once, missing
   `current_range_meters`, missing `lat`, `lon: 999`, non-string id, and an empty
   `data.bikes` array yielding an empty-but-valid snapshot.

9. **README correction.** Update the `Vehicle` block in `README.md` to match the
   shipped model: millisecond timestamps, `VehicleSnapshot`, `droppedCount`, and
   a one-line note on the two-level failure contract.

## Acceptance criteria

**Build and tooling**

- [ ] `npm ci && npm run build` completes with no errors.
- [ ] `npm run lint` passes, including the `prettier/prettier` rule.
- [ ] `npm test` passes and every test in `gbfs-mapper.spec.ts` is green.
- [ ] No `any` appears in any file added by this spec.

**Boundary**

- [ ] `maplibre-gl` is not imported by any file in this spec.
- [ ] `gbfs.types.ts` is imported only from inside `src/app/core/gbfs/`.
- [ ] `vehicle.model.ts` imports nothing from `src/app/core/gbfs/`.
- [ ] `GbfsMapper.toSnapshot` accepts `unknown` and performs no HTTP call.
- [ ] `GbfsMapper` is decorated with `@Service` and neither declares
      `standalone: true` nor `changeDetection`.

**Mapping**

- [ ] Mapping the committed Lime fixture returns 15 vehicles and
      `droppedCount === 0`.
- [ ] The 2.2 fixture and its synthetic 3.x equivalent produce deep-equal
      `vehicles` arrays.
- [ ] The fixture's `last_updated` maps to `lastUpdated` equal to that value
      multiplied by 1000.
- [ ] A `last_reported` of `'2026-07-29T00:00:00Z'` maps to the same epoch
      milliseconds as the equivalent POSIX-seconds integer.
- [ ] A numeric `last_reported` above `1e11` is passed through unscaled.
- [ ] `ttl: 60` maps to `ttlMs === 60000`; a missing `ttl` maps to `60000`.
- [ ] A missing `last_updated` maps to `lastUpdated === 0`.

**Status**

- [ ] `is_reserved: false, is_disabled: false` maps to `status === 'available'`.
- [ ] `is_reserved: true, is_disabled: false` maps to `status === 'reserved'`.
- [ ] `is_reserved: false, is_disabled: true` maps to `status === 'disabled'`.
- [ ] `is_reserved: true, is_disabled: true` maps to `status === 'disabled'`,
      with `isReserved === true` and `isDisabled === true` both preserved.

**Failure contract**

- [ ] An item with a missing `lat` is absent from `vehicles` and adds `1` to
      `droppedCount`.
- [ ] An item with `lon: 999` is dropped and counted.
- [ ] An item with a non-string id is dropped and counted.
- [ ] An item with a missing `current_range_meters` is kept, with
      `currentRangeMeters === undefined`.
- [ ] `data.bikes: []` returns a valid snapshot with `vehicles.length === 0` and
      `droppedCount === 0`, and does not throw.
- [ ] `toSnapshot(null)`, `toSnapshot({})` and `toSnapshot({ data: {} })` each
      throw `GbfsMapperError`.
- [ ] No mapped `Vehicle` has `stationId` defined.

**Documentation**

- [ ] The `Vehicle` block in `README.md` is byte-identical to the interface in
      `vehicle.model.ts`.
- [ ] `README.md` documents `VehicleSnapshot` and states that timestamps are
      epoch milliseconds.

## Decisions

**Boundary and shape**

- **Yes:** the mapper is pure and network-free. It is the only layer testable
  without HTTP, and keeping it that way makes `GbfsApiService` (SPEC 02) a thin
  shell with nothing to test.
- **Yes:** `GbfsMapper` is a `@Service` singleton rather than exported pure
  functions or static methods. The behaviour is identical, but it keeps the
  layer diagram in `README.md` honest and makes the mapper injectable and
  fakeable from the store's tests.
- **No:** static methods. They read as a class but are a namespace, and they
  cannot be substituted through DI.

**Return type**

- **Yes:** `VehicleSnapshot` rather than a bare `Vehicle[]`. `ttl` and
  `last_updated` only exist on the raw envelope; if the mapper discarded them,
  the polling layer would have to re-read the raw payload and the mapper would
  stop being the single translation boundary.
- **Yes:** `droppedCount` on the snapshot. Silent drops make a degrading feed
  invisible; the counter costs one field and gives the UI something to say.

**Validation**

- **Yes:** hand-written type guards over an `unknown` input. Roughly thirty
  lines, no new dependency, and the guards sit exactly where a different
  provider breaks things.
- **No:** zod or valibot. A runtime schema library for one feed shape is weight
  the 4–6 hour budget cannot justify, and it would need its own bundle-size
  defence.
- **No:** trusting a cast at the API-service boundary. `CLAUDE.md` requires
  `unknown` before the mapper, and a cast is a lie the compiler cannot check.
- **Yes:** coordinate range validation, not just finiteness. A misparsed `0, 0`
  is a valid number that would stretch the map's `fitBounds` across the Atlantic.

**Failure handling**

- **Yes:** two levels. Bad item → drop and count; bad envelope → throw
  `GbfsMapperError`. A corrupt vehicle is a data point, an unusable envelope is
  an outage, and collapsing them would render a feed failure as "no vehicles
  available".
- **No:** throwing on a bad item. One malformed record out of 3,100 would blank
  the map.
- **Yes:** `0` and `60000` as fallbacks for `lastUpdated` and `ttlMs`. Making
  them optional would push `number | undefined` into the polling interval
  calculation for no gain.

**Dialects**

- **Yes:** GBFS 2.2 and 3.x in one mapper, keyed on which fields are present
  rather than on a declared `version` string. The renames are few (`bikes` →
  `vehicles`, `bike_id` → `vehicle_id`, POSIX seconds → RFC3339) and feeds in the
  wild misreport their version.
- **No:** station-based feeds. Joining `station_status` with
  `station_information` is a second data source, not a rename, and it needs its
  own spec.
- **Yes:** keep `stationId` on `Vehicle` while nothing populates it. It is the
  visible seam that proves the domain contract can absorb a station-based
  provider without a breaking change.

**Domain conventions**

- **Yes:** epoch milliseconds everywhere in the domain. It is the JavaScript
  canon and it collapses the 2.2/3.x timestamp divergence at the boundary
  instead of leaking it to every consumer.
- **No:** `Date` objects. They are mutable, awkward to compare in assertions,
  and serialise inconsistently.
- **Yes:** named `{ lat, lon }` over a GeoJSON `[lon, lat]` tuple. The reversed
  ordering is the classic geo bug; it belongs behind `MapLibreService`, not in
  the domain model.
- **Yes:** `is_disabled` beats `is_reserved`, with both raw booleans preserved.
  A broken vehicle is not rentable regardless of a stale reservation, and
  keeping the booleans means the derived `status` loses no information.

**Process**

- **Yes:** correct `README.md` in this spec rather than in a follow-up. The
  README is the design contract; leaving it describing a model that does not
  exist would invert that relationship.

## Risks

| Risk                                                                                                                                                     | Mitigation                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The committed fixture freezes today's Lime shape. Tests stay green while the live feed drifts.                                                           | The fixture is a regression baseline, not a liveness check. SPEC 02 wires the real HTTP call and is the step that re-verifies the live shape.                                 |
| The GBFS 3.x path is tested only against a synthetic payload. No 3.x provider is wired up, so the dialect assumptions could be wrong.                    | Synthetic payloads are derived from the published MobilityData 3.0 schema, not from recall. `README.md` already lists uniform/unobserved states under "Known limitations".    |
| RFC3339 parsing leans on `Date.parse`, whose behaviour is implementation-defined for non-ISO strings.                                                    | Only `Date.parse` is used, and a `NaN` result yields `undefined` rather than a bogus timestamp. Tests cover `Z`, numeric offsets and garbage.                                 |
| A wholly malformed feed produces an empty `vehicles` array with a large `droppedCount`, which the UI would render as "no vehicles" rather than an error. | The mapper reports the count; deciding the threshold at which a high drop rate becomes an error state belongs to `VehicleStore` in SPEC 02, where the UI states are modelled. |
| A numeric `last_reported` already in milliseconds would be multiplied by 1000 again, landing the vehicle in the year 57000.                              | Numeric timestamps above `1e11` are treated as already-milliseconds instead of seconds. GBFS mandates seconds, so this only guards against a non-conforming provider.         |

## What is **not** in this spec

- `GbfsApiService`, the dev proxy call, or any HTTP whatsoever.
- `VehicleStore`, signals, `computed()` derived state, polling, retry or backoff.
- Deciding when a high `droppedCount` becomes a user-visible error.
- Station-based providers. `stationId` ships unpopulated on purpose.
- The GBFS discovery document (`gbfs.json`) and language selection.
- Any component, template, map or `maplibre-gl` code.
- Filtering, sorting, searching or clustering.

Each one of those, if it lands, goes in its own spec.
