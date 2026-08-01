import { Service } from '@angular/core';
import type {
  DataDrivenPropertyValueSpecification,
  FilterSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
} from 'maplibre-gl';
import {
  HALO_RESTING_FRAME,
  haloFrame,
  type HaloFrame,
} from './halo-pulse/halo-pulse';
import {
  RANGE_BUCKETS,
  UNKNOWN_RANGE_COLOR,
} from './range-buckets/range-buckets';
import type { VehicleCollection } from './vehicle-geojson/vehicle-geojson';

/** Keyless vector tiles. Light enough for the vehicles to carry the weight. */
const STYLE_URL =
  'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

/** Centre of the feed's Queens/Bronx bounds, so the first paint is not empty. */
const INITIAL_CENTER: [number, number] = [-73.814, 40.788];
const INITIAL_ZOOM = 10.5;

const VEHICLES_SOURCE = 'vehicles';
const VEHICLES_LAYER = 'vehicles';
const SELECTED_LAYER = 'vehicles-selected';
const HALO_LAYER = 'vehicles-halo';
const ICON_LAYER = 'vehicles-icon';
const SELECTED_ICON_LAYER = 'vehicles-selected-icon';

const SCOOTER_IMAGE = 'scooter';

/**
 * A circle layer has one stroke, so the selected disc cannot carry both this
 * and a dark ring. White separates it from whatever is behind it, and the halo
 * is what says "selected".
 */
const SELECTION_RING_COLOR = '#ffffff';

/**
 * Below this the disc is under ~13px across and a glyph inside it is a smudge.
 * It is also what keeps MapLibre from building symbol buckets for thousands of
 * features at city zoom: a symbol layer hidden with `icon-opacity` would cost
 * exactly the same as a visible one.
 */
const ICON_MIN_ZOOM = 14;

/**
 * From the design mockup. Drawn in one flat colour over the coloured disc, so a
 * single image serves every bucket — tinting would need an SDF, and a rasterised
 * SVG is not one.
 */
const SCOOTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="6.5" cy="19" r="3.4" fill="#1f2937"/><circle cx="18" cy="19" r="3.4" fill="#1f2937"/><path d="M4.5 3 H10.5 M7.2 3 V15.5 L18 15.5" stroke="#1f2937" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const EMPTY_COLLECTION: VehicleCollection = {
  type: 'FeatureCollection',
  features: [],
};

/** No id is ever the empty string, so the selection layer starts empty. */
const MATCHES_NOTHING: FilterSpecification = ['==', ['get', 'id'], ''];

/** The same trick inverted: every feature, until a selection excludes one. */
const MATCHES_EVERYTHING: FilterSpecification = ['!=', ['get', 'id'], ''];

/**
 * Generated from `RANGE_BUCKETS` rather than written out, so the map and the
 * legend cannot disagree. The `-1` of a missing range falls below the first
 * stop and lands on the default branch, which is the grey.
 */
function circleColor(): DataDrivenPropertyValueSpecification<string> {
  const stops = RANGE_BUCKETS.flatMap(bucket => [
    bucket.fromMeters,
    bucket.color,
  ]);

  return [
    'step',
    ['get', 'rangeMeters'],
    UNKNOWN_RANGE_COLOR,
    ...stops,
  ] as DataDrivenPropertyValueSpecification<string>;
}

/**
 * Read per selection rather than cached, so someone who changes the setting
 * gets the new behaviour on their next click instead of on their next reload.
 */
function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type MapLibreModule = typeof import('maplibre-gl');

/**
 * `maplibre-gl` ships a UMD bundle while declaring `"type": "module"`, so its
 * runtime shape depends on the build: an optimized chunk carries a lone
 * `default`, an unoptimized one also gets esbuild's named-export shims. Its
 * typings declare only the named exports, hence the cast. Reading `default`
 * first makes both builds take the same path — destructuring the namespace
 * directly yields `undefined` in production and fails on `new Map()`.
 */
async function loadMapLibre(): Promise<MapLibreModule> {
  const module = await import('maplibre-gl');
  const interop = module as unknown as { default?: MapLibreModule };

  return interop.default ?? module;
}

/**
 * The only module in the repo allowed to name `maplibre-gl`. It owns the map,
 * its source and its layers; callers speak GeoJSON and vehicle ids, never
 * MapLibre objects.
 */
@Service()
export class MapLibreService {
  #map: MapLibreMap | null = null;
  #loaded = false;
  #iconsReady = false;
  #onVehicleClick: ((id: string) => void) | null = null;

  #selectedId: string | null = null;
  #haloFrameId: number | null = null;
  #haloStart = 0;

  /**
   * Resolves once the style is up and the map can take data. The library is
   * imported here so its ~900 kB land in a lazy chunk instead of the initial
   * bundle. Rejects if the chunk or the style fails to load.
   */
  async create(container: HTMLElement): Promise<void> {
    const { Map, AttributionControl, NavigationControl } = await loadMapLibre();

    const map = new Map({
      container,
      style: STYLE_URL,
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      // Re-added expanded below: attribution is a licence obligation, and the
      // default control hides it behind a click on narrow screens.
      attributionControl: false,
    });

    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new AttributionControl({ compact: false }), 'bottom-right');

    this.#map = map;
    await this.#whenLoaded(map);

    // A `destroy()` during the await has already dropped this map.
    if (this.#map !== map) return;

    // Before the layers: a layer naming an image that does not exist yet makes
    // MapLibre warn once per tile, forever.
    await this.#addScooterIcon(map);
    if (this.#map !== map) return;

    this.#buildLayers(map);
    this.#loaded = true;
  }

  /** One `setData` on the source built in `create()`. Never a rebuild. */
  setVehicles(collection: VehicleCollection): void {
    this.#readyMap
      ?.getSource<GeoJSONSource>(VEHICLES_SOURCE)
      ?.setData(collection);
  }

  /**
   * Frames the data instead of trusting the hardcoded initial camera. The
   * caller decides when: fitting on every tick would yank the viewport out
   * from under anyone who panned.
   */
  fitToData(collection: VehicleCollection): void {
    const map = this.#readyMap;
    if (map === null || collection.features.length === 0) return;

    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;

    for (const feature of collection.features) {
      const [lon, lat] = feature.geometry.coordinates;
      west = Math.min(west, lon);
      south = Math.min(south, lat);
      east = Math.max(east, lon);
      north = Math.max(north, lat);
    }

    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      // `maxZoom` keeps a fleet parked on one street from filling the screen.
      { padding: 48, maxZoom: 14, duration: 0 }
    );
  }

  /**
   * Moves the highlight with a filter, not with data: the source is untouched,
   * so selecting one vehicle never repaints the other 3,100.
   */
  setSelected(id: string | null): void {
    const map = this.#readyMap;
    if (map === null) return;

    const matchesSelection: FilterSpecification =
      id === null ? MATCHES_NOTHING : ['==', ['get', 'id'], id];

    map.setFilter(SELECTED_LAYER, matchesSelection);
    map.setFilter(HALO_LAYER, matchesSelection);

    // `selected()` is recomputed on every tick, so this arrives once a minute
    // with the same id. Restarting the pulse then would snap the halo back to
    // its smallest radius in front of the user, once a minute.
    const changed = id !== this.#selectedId;
    this.#selectedId = id;

    if (id === null) {
      this.#stopHalo();
    } else if (changed) {
      this.#startHalo();
    }

    if (!this.#iconsReady) return;

    map.setFilter(SELECTED_ICON_LAYER, matchesSelection);
    // The fleet layer gives the selected vehicle up, or the two would draw the
    // same glyph at two different sizes on the same point.
    map.setFilter(
      ICON_LAYER,
      id === null ? MATCHES_EVERYTHING : ['!=', ['get', 'id'], id]
    );
  }

  /** Registered once in `create()`; the handler is what changes. */
  onVehicleClick(handler: (id: string) => void): void {
    this.#onVehicleClick = handler;
  }

  destroy(): void {
    // Before `remove()`: a frame already scheduled would wake up to a map that
    // no longer exists.
    this.#stopHalo();

    this.#map?.remove();
    this.#map = null;
    this.#loaded = false;
    this.#iconsReady = false;
    this.#selectedId = null;
    this.#onVehicleClick = null;
  }

  /**
   * One feature is animated, whatever the fleet size, because the layer is
   * filtered to the selection. Under reduced motion the halo is painted once
   * and no frame is ever requested.
   */
  #startHalo(): void {
    this.#stopHalo();

    if (prefersReducedMotion()) {
      this.#paintHalo(HALO_RESTING_FRAME);
      return;
    }

    this.#haloStart = performance.now();
    this.#haloFrameId = requestAnimationFrame(now => this.#pulse(now));
  }

  #pulse(now: number): void {
    if (this.#readyMap === null) {
      this.#haloFrameId = null;
      return;
    }

    this.#paintHalo(haloFrame(now - this.#haloStart));
    this.#haloFrameId = requestAnimationFrame(next => this.#pulse(next));
  }

  #stopHalo(): void {
    if (this.#haloFrameId === null) return;

    cancelAnimationFrame(this.#haloFrameId);
    this.#haloFrameId = null;
  }

  #paintHalo(frame: HaloFrame): void {
    const map = this.#readyMap;
    if (map === null) return;

    map.setPaintProperty(HALO_LAYER, 'circle-radius', frame.radius);
    map.setPaintProperty(HALO_LAYER, 'circle-opacity', frame.opacity);
  }

  /**
   * A failure here costs the glyph, not the map: plain coloured discs are what
   * the product was before this layer existed, and a blank map is not an
   * acceptable answer to a broken icon.
   */
  async #addScooterIcon(map: MapLibreMap): Promise<void> {
    try {
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SCOOTER_SVG)}`;
      await image.decode();

      // The SVG rasterises at 24px for a 12px glyph, so it stays crisp on a
      // retina screen without shipping a second asset.
      map.addImage(SCOOTER_IMAGE, image, { pixelRatio: 2 });
      this.#iconsReady = true;
    } catch (error) {
      console.error('The scooter icon could not be loaded', error);
    }
  }

  /** Null until the source exists, which is what makes every caller a no-op. */
  get #readyMap(): MapLibreMap | null {
    return this.#loaded ? this.#map : null;
  }

  #buildLayers(map: MapLibreMap): void {
    map.addSource(VEHICLES_SOURCE, {
      type: 'geojson',
      data: EMPTY_COLLECTION,
    });

    // First, so it sits under every disc: a halo drawn over the fleet would
    // wash out the vehicles it is meant to point at.
    map.addLayer({
      id: HALO_LAYER,
      type: 'circle',
      source: VEHICLES_SOURCE,
      filter: MATCHES_NOTHING,
      paint: {
        // The vehicle's own bucket colour, so the halo says which one it is,
        // not merely that something is selected.
        'circle-color': circleColor(),
        'circle-radius': HALO_RESTING_FRAME.radius,
        'circle-opacity': HALO_RESTING_FRAME.opacity,
      },
    });

    map.addLayer({
      id: VEHICLES_LAYER,
      type: 'circle',
      source: VEHICLES_SOURCE,
      paint: {
        'circle-color': circleColor(),
        // Small enough that 3,100 points stay distinguishable at city zoom.
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          9,
          2,
          12,
          4,
          16,
          9,
        ],
        'circle-opacity': 0.85,
      },
    });

    // Created with a filter that matches nothing, so no vehicle is highlighted
    // before a selection exists.
    map.addLayer({
      id: SELECTED_LAYER,
      type: 'circle',
      source: VEHICLES_SOURCE,
      filter: MATCHES_NOTHING,
      paint: {
        'circle-color': circleColor(),
        'circle-radius': 10,
        'circle-stroke-color': SELECTION_RING_COLOR,
        'circle-stroke-width': 3,
      },
    });

    this.#buildIconLayers(map);
    this.#bindInteractions(map);
  }

  /**
   * Both layers skip collision detection: overlapping markers are what a fleet
   * map looks like, and placing thousands of icons against each other is the
   * other cost worth not paying.
   */
  #buildIconLayers(map: MapLibreMap): void {
    if (!this.#iconsReady) return;

    map.addLayer({
      id: ICON_LAYER,
      type: 'symbol',
      source: VEHICLES_SOURCE,
      minzoom: ICON_MIN_ZOOM,
      filter: MATCHES_EVERYTHING,
      layout: {
        'icon-image': SCOOTER_IMAGE,
        // Tracks the disc: the glyph has to stay inside the circle it sits on.
        'icon-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14,
          0.7,
          16,
          1,
          18,
          1.2,
        ],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });

    // One feature, so no `minzoom`: the vehicle the user is looking at carries
    // its glyph at every zoom.
    map.addLayer({
      id: SELECTED_ICON_LAYER,
      type: 'symbol',
      source: VEHICLES_SOURCE,
      filter: MATCHES_NOTHING,
      layout: {
        'icon-image': SCOOTER_IMAGE,
        'icon-size': 1,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });
  }

  #bindInteractions(map: MapLibreMap): void {
    map.on('click', VEHICLES_LAYER, (event: MapLayerMouseEvent) => {
      // `properties.id` rather than `feature.id`: the property survives tile
      // encoding, the identity does not always.
      const id = event.features?.[0]?.properties?.['id'];
      if (typeof id === 'string') this.#onVehicleClick?.(id);
    });

    map.on('mouseenter', VEHICLES_LAYER, () => {
      map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', VEHICLES_LAYER, () => {
      map.getCanvas().style.cursor = '';
    });
  }

  #whenLoaded(map: MapLibreMap): Promise<void> {
    return new Promise((resolve, reject) => {
      const onLoad = () => {
        map.off('error', onError);
        resolve();
      };
      // Before `load` an error is the style or the chunk failing, not a stray
      // tile: there is nothing on screen yet to keep.
      const onError = (event: { error: Error }) => {
        map.off('load', onLoad);
        reject(event.error);
      };

      map.once('load', onLoad);
      map.once('error', onError);
    });
  }
}
