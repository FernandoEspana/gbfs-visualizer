# SPEC 06 — Scooter marker icon and animated selection halo

> **Status:** Implemented
> **Depends on:** SPEC 04, SPEC 05
> **Date:** 2026-07-31
> **Objective:** Replace the flat coloured dot with a marker that reads as a scooter, and replace the generic dark selection ring with a halo that pulses in the selected vehicle's own battery colour — without adding a single DOM node per vehicle and without costing anything at city zoom.

## Scope

**In:**

- A scooter glyph inlined as an SVG string in `MapLibreService` and registered
  once with `map.addImage()`. Single dark colour over the coloured disc, so no
  SDF and no per-bucket tinting: one image serves every bucket.
- `vehicles-icon`, a `symbol` layer over the whole fleet with `minzoom: 14` —
  the zoom at which the disc is finally large enough to carry a glyph.
- `vehicles-selected-icon`, a `symbol` layer filtered to the selected id with no
  `minzoom`, so the glyph is always present on the vehicle the user is looking
  at.
- `vehicles-halo`, a `circle` layer under the fleet, filtered to the selected id,
  whose radius and opacity are animated by `requestAnimationFrame`.
- `src/app/core/map/halo-pulse.ts` + spec: the pulse geometry as pure functions,
  so the part that can be wrong is the part that is tested.
- `prefers-reduced-motion: reduce` paints the halo at a resting frame and never
  starts the loop.
- The selected disc's stroke changes from `SELECTION_COLOR` to white, per the
  mockup. `SELECTION_COLOR` is then unused and is removed.
- `README.md`: the marker anatomy, the zoom threshold and why, the reduced-motion
  behaviour, and the layer inventory.

**Out of scope (for future specs):**

- Mockup variants **1b** (info card floating over the marker) and **1c** (static
  double ring). 1b duplicates the detail panel SPEC 05 shipped.
- Any camera movement: no fly-to, no zoom-to-selection.
- Clustering, and animating vehicle positions between ticks.
- Hover states on the map.
- Any change to `GbfsApi`, `GbfsMapper`, `VehiclePolling`, `VehicleStore` or any
  component. `MapComponent` already calls `setSelected()`; if this spec needs a
  component change, the map seam was wrong.

## Data model

No domain data changes. `Vehicle`, `VehicleSnapshot`, `VehicleCollection` and
`VehicleFeatureProperties` are untouched: the halo and the icon are paint, and
paint is derived from `rangeMeters` and `id`, both already on the feature.

### Pulse geometry — `src/app/core/map/halo-pulse.ts`

```typescript
export const HALO_PERIOD_MS = 1_600;

export interface HaloFrame {
  radius: number; // px
  opacity: number; // 0..1
}

/** Where the pulse is, `elapsedMs` after it started. Periodic and pure. */
export function haloFrame(elapsedMs: number): HaloFrame;

/** What the halo looks like when motion is not allowed. */
export const HALO_RESTING_FRAME: HaloFrame;
```

Conventions:

- The pulse runs `radius` from 12px to 34px and `opacity` from 0.55 to 0, on an
  ease-out cubic — the mockup's `ease-out`, its `.55` opacity, and its 1.6s
  period. Its `scale(0.6) → scale(2.6)` of a 44px circle is not carried over
  literally: 114px of glow over a real basemap swallows the neighbouring
  vehicles.
- `haloFrame` is periodic: `haloFrame(t)` equals `haloFrame(t + 1_600)`.
- A negative `elapsedMs` yields the first frame rather than wrapping backwards,
  so a clock that runs backwards cannot produce a halo of negative radius.
- `HALO_RESTING_FRAME` is a mid-pulse frame, not a zero one: under reduced motion
  the halo still has to say "this one is selected".

### Layer inventory after this spec

Bottom to top, all created once inside `#buildLayers`:

| Layer                    | Type     | Filter when nothing is selected | Notes                                             |
| ------------------------ | -------- | ------------------------------- | ------------------------------------------------- |
| `vehicles-halo`          | `circle` | matches nothing                 | New. Animated `circle-radius` / `circle-opacity`. |
| `vehicles`               | `circle` | none                            | **Unchanged.**                                    |
| `vehicles-selected`      | `circle` | matches nothing                 | Existing. White stroke replaces the dark one.     |
| `vehicles-icon`          | `symbol` | matches everything              | New. `minzoom: 14`.                               |
| `vehicles-selected-icon` | `symbol` | matches nothing                 | New. No `minzoom`.                                |

`setSelected(id)` grows from one `setFilter` to four: the three selected-only
layers gain the id, and `vehicles-icon` **excludes** it, so the selected vehicle
is never drawn by two symbol layers at two different sizes.

## Implementation plan

Each step leaves `npm run lint && npm run build && npm test` green.

1. **Pulse geometry.** Create `halo-pulse.ts` and `halo-pulse.spec.ts`. Tests:
   the first frame is the smallest and most opaque, the last is the largest and
   fully transparent, the function is periodic across a period boundary, a
   negative elapsed time yields the first frame, and radius is monotonically
   increasing across a period. Pure module, no MapLibre import. No UI yet.

2. **The scooter icon.** Add `SCOOTER_SVG` and a private `#addScooterIcon(map)`
   to `MapLibreService`: SVG string → `data:image/svg+xml` → `Image` →
   `await img.decode()` → `map.addImage('scooter', img, { pixelRatio: 2 })`,
   awaited in `create()` **before** `#buildLayers`. Add `vehicles-icon`
   (`minzoom: 14`) and `vehicles-selected-icon`, both with
   `icon-allow-overlap: true` and `icon-ignore-placement: true`, and extend
   `setSelected()` to drive their filters. A failure to decode the icon must
   leave a working map: it is caught, logged once, and the two symbol layers are
   skipped. **Manual check:** at the initial zoom nothing changes; past zoom 14
   every disc carries a glyph.

3. **The halo.** Add the `vehicles-halo` layer beneath `vehicles`, the rAF loop
   (`#haloFrameId`, `#haloStart`), the reduced-motion branch, and cancellation in
   both `setSelected(null)` and `destroy()`. Change the selected disc's stroke to
   white and delete `SELECTION_COLOR` from `range-buckets.ts`. **Manual check:**
   selecting from the map and from the list both pulse in that vehicle's bucket
   colour; deselecting stops the repaint loop.

4. **README.** Marker anatomy, the zoom threshold and why symbol layers are the
   expensive kind, the halo and its reduced-motion behaviour, the updated layer
   inventory, and the selection colour change.

5. **Live verification.** With `npm start`: pan the full fleet at the initial
   zoom and confirm nothing regressed, zoom past 14, select from both directions,
   confirm the loop stops on deselect in the Performance panel, let a tick land
   with a selection open, emulate reduced motion, and run an AXE pass. Record the
   observed numbers in the commit message.

## Acceptance criteria

**Build and tooling**

- [ ] `npm ci && npm run build` completes with no errors and no budget warning.
- [ ] `npm run lint` passes, including `prettier/prettier`.
- [ ] `npm test` passes; every test added here is green.
- [ ] No `any` in any file this spec touches.

**Boundary**

- [ ] `grep -rn "maplibre-gl" src` still matches only `maplibre.service.ts` and
      the pre-existing `@import` in `src/styles.css`.
- [ ] `halo-pulse.ts` imports nothing — not Angular, not `maplibre-gl`.
- [ ] No component, no store, no polling and no mapper file is modified.
- [ ] `MapComponent`'s public interaction with the service is unchanged:
      `setVehicles`, `setSelected`, `fitToData`, `onVehicleClick`, `destroy`.
- [ ] `map.component.spec.ts` passes without modification.

**Pulse geometry**

- [ ] `haloFrame(0)` is the smallest radius and the highest opacity.
- [ ] `haloFrame(HALO_PERIOD_MS)` equals `haloFrame(0)`.
- [ ] Opacity reaches 0 at the end of a period and is never negative.
- [ ] Radius never decreases within a period.
- [ ] A negative elapsed time returns the first frame, never a negative radius.

**Icon**

- [ ] `addImage` is called exactly once, in `create()`, before any layer that
      references the image.
- [ ] The console shows no "image not found" warnings while panning at any zoom.
- [ ] Below zoom 14 the only glyph on screen belongs to the selected vehicle.
- [ ] At zoom ≥ 14 every disc carries a glyph, sized so it stays inside the disc.
- [ ] The selected vehicle is never drawn by both symbol layers at once.
- [ ] If the icon fails to load, the map still renders vehicles and selection
      still works.

**Halo**

- [ ] With no selection, `vehicles-halo` matches nothing and no frame is
      scheduled.
- [ ] Selecting from the map and selecting from the list produce the same halo.
- [ ] The halo's colour is that vehicle's bucket colour, the same one the disc
      and the list dot use.
- [ ] `store.clearSelection()` removes the halo **and** cancels the frame loop.
- [ ] `destroy()` cancels any pending frame; no callback runs after `map.remove()`.
- [ ] A tick landing with a selection open does not restart or interrupt the
      pulse.
- [ ] Under `prefers-reduced-motion: reduce` the halo is visible, static, and no
      animation frame is ever requested.

**Performance**

- [ ] At the initial zoom, panning the full fleet is as smooth as before this
      spec — the symbol layer is not rendered at that zoom.
- [ ] With no selection open, the map is not repainting continuously.
- [ ] The initial bundle grows by less than 2 kB: the icon is an inline string,
      not an asset.

**Visual and accessibility**

- [ ] The selected disc is distinguishable from its neighbours with the animation
      disabled — selection is never signalled by motion alone.
- [ ] The same selection remains visible as `aria-selected` in the list and as an
      open detail panel.
- [ ] The legend still matches the map: bucket colours are unchanged.
- [ ] An AXE pass reports no violations, with a selection open and with none.

## Decisions

**The icon**

- **Yes:** a `symbol` layer. It is the only way to put an image on a feature
  without a DOM marker, and DOM markers are the one thing the map layer has
  refused since SPEC 04.
- **Yes:** `minzoom: 14` for the fleet. Symbol layers are the expensive kind —
  they build per-tile symbol buckets — and `minzoom` is what stops that work
  happening at all at city zoom. Hiding the icons with `icon-opacity: 0` would
  look identical and cost the same as showing them.
- **No:** a single symbol layer with a zoom-aware filter. `["zoom"]` is not
  usable inside a layer `filter`, and even if it were, the cost above is what
  `minzoom` avoids.
- **Yes:** a second symbol layer for the selection. It is one feature, so its
  bucket is trivial, and it buys a glyph on the selected vehicle at every zoom.
- **Yes:** a single dark glyph rather than a tinted one. The mockup draws the
  scooter in `#1f2937` over the coloured disc, so one image serves all five
  colours. Tinting would need an SDF, and a rasterised SVG is not a real signed
  distance field — the edges would be wrong for the sake of a colour the disc
  underneath already carries.
- **Yes:** inline SVG rather than a file in `public/`. It is a few hundred bytes,
  it cannot 404, and it keeps the map's assets inside the one module that owns
  the map.

**The halo**

- **Yes:** `requestAnimationFrame` over `setPaintProperty`. MapLibre draws to a
  canvas, so CSS animation is not available; the alternative is an animated
  `StyleImageInterface`, which is more machinery for the same repaint.
- **Yes:** one feature only. The loop touches a layer filtered to the selection,
  so the cost is bounded no matter how large the fleet gets.
- **Yes:** the pulse maths in a pure module. `MapLibreService` has no unit test
  by documented design — jsdom has no WebGL — so anything in it that can be
  arithmetically wrong should not be in it.
- **Yes:** stop the loop on deselect. A permanent 60fps repaint over a map the
  user is no longer interacting with is a battery cost with nothing on the other
  side of the trade.
- **Yes:** honour `prefers-reduced-motion`. A pulsing halo is exactly the kind of
  motion that setting exists for, and the resting frame keeps the selection
  legible without it.
- **No:** animating the disc itself. The mockup grows the selected dot on click;
  the disc is already enlarged for selection, and a second moving element around
  the same point reads as noise.

**Colour**

- **Yes:** keep `RANGE_BUCKETS` as they are. The mockup uses `#dc2626 / #f59e0b /
#2563eb / #16a34a`; the repo's ramp was chosen to stay separable for colour
  vision deficiency, and both the paint expression and the legend are generated
  from it. Adopting the mockup's hexes would be a one-constant change with no
  argument behind it.
- **Yes:** a white stroke on the selected disc, replacing `SELECTION_COLOR`. A
  circle layer has one stroke, so the disc cannot carry both the mockup's white
  border and the old dark ring. The halo is now the thing that says "selected",
  and white separates the disc from whatever is behind it.
- **Yes:** delete `SELECTION_COLOR` rather than leave it exported. An unused
  constant in a file whose whole point is being the single source of colour truth
  is worse than a diff.

## Risks

| Risk                                                                                                                                                  | Mitigation                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A symbol layer over 3,362 features is far more expensive than a circle layer, and this spec exists next to a hard performance criterion.              | `minzoom: 14` means the layer is not rendered — and its buckets not built — at the zooms where the whole fleet is on screen. Plus `icon-allow-overlap`, which skips collision detection entirely.       |
| `addLayer` referencing an image that has not been added yet makes MapLibre log a missing-image warning for every tile, forever.                       | `#addScooterIcon` is awaited inside `create()` before `#buildLayers` runs. The console being clean while panning is an acceptance criterion.                                                            |
| `img.decode()` can reject — a malformed data URI, a hostile CSP — and an unhandled rejection inside `create()` would take the whole map down with it. | The icon load is wrapped: on failure it is logged once and the two symbol layers are skipped. A map with plain discs is the current product; a blank map is not.                                        |
| The selected vehicle matches both `vehicles-icon` and `vehicles-selected-icon`, drawing the same glyph twice at two different sizes.                  | `vehicles-icon`'s filter excludes the selected id. `setSelected` updates all four filters together, so the two can never disagree.                                                                      |
| An animation frame scheduled just before `destroy()` fires after `map.remove()`, calling `setPaintProperty` on a removed map.                         | `destroy()` cancels the pending frame before removing the map, and the loop re-reads `#readyMap` — which is null once destroyed — on every frame.                                                       |
| The rAF loop repaints the canvas ~60 times a second for as long as a vehicle is selected, over a map with thousands of features.                      | Bounded to the time a detail panel is open, cancelled on deselect and on destroy, and never started under reduced motion. It is the same work panning already does, and it is the price of the effect.  |
| Motion becomes the thing that communicates selection, which fails for anyone who cannot see it or has disabled it.                                    | The disc is already enlarged and white-ringed before any halo is drawn, and the same selection is `aria-selected` in the list with the detail panel open. The halo is a third signal, not the only one. |
| A white stroke on a near-white basemap could read worse than the dark ring it replaces.                                                               | Checked against CARTO Positron during the live verification, with a selection in each of the five bucket colours. If it fails, the fallback is the existing `SELECTION_COLOR`, one constant away.       |

## What is **not** in this spec

- Mockup variants 1b (info card) and 1c (static double ring).
- Camera movement of any kind.
- Clustering, and animating vehicle positions between ticks.
- Hover states on the map.
- Any change outside `src/app/core/map/` and `README.md`.

## Implementation notes

Two things surfaced during implementation and are recorded here so the spec
matches the code.

**The pulse restarts on every tick, unless stopped.** `MapComponent` pushes
`store.selected()?.id` into the service from an `effect()`, and `selected()` is
recomputed against each new snapshot — so `setSelected()` arrives once a minute
with the same id. Restarting the pulse there snaps the halo back to its smallest
radius in front of the user, once a minute, forever. The service now tracks the
current id and only restarts the animation when it actually changes. Without
this the "a tick does not interrupt the pulse" criterion fails.

**`HALO_RESTING_FRAME` is not the midpoint.** The spec called it "a mid-pulse
frame". An ease-out curve spends most of its opacity in the first half, so the
literal midpoint renders at 0.07 alpha — technically a halo, visually nothing.
It is taken at a quarter of the period instead, which is still a frame of the
same pulse and is actually visible. It matters because it is the whole of what a
reduced-motion user ever sees, and it has a test that pins it above 0.15.
