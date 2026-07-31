import { Service } from '@angular/core';
import type {
  DataDrivenPropertyValueSpecification,
  FilterSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
} from 'maplibre-gl';
import {
  RANGE_BUCKETS,
  SELECTION_COLOR,
  UNKNOWN_RANGE_COLOR,
} from './range-buckets';
import type { VehicleCollection } from './vehicle-geojson';

/** Keyless vector tiles. Light enough for the vehicles to carry the weight. */
const STYLE_URL =
  'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

/** Centre of the feed's Queens/Bronx bounds, so the first paint is not empty. */
const INITIAL_CENTER: [number, number] = [-73.814, 40.788];
const INITIAL_ZOOM = 10.5;

const VEHICLES_SOURCE = 'vehicles';
const VEHICLES_LAYER = 'vehicles';
const SELECTED_LAYER = 'vehicles-selected';

const EMPTY_COLLECTION: VehicleCollection = {
  type: 'FeatureCollection',
  features: [],
};

/** No id is ever the empty string, so the selection layer starts empty. */
const MATCHES_NOTHING: FilterSpecification = ['==', ['get', 'id'], ''];

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
 * The only module in the repo allowed to name `maplibre-gl`. It owns the map,
 * its source and its layers; callers speak GeoJSON and vehicle ids, never
 * MapLibre objects.
 */
@Service()
export class MapLibreService {
  #map: MapLibreMap | null = null;
  #loaded = false;
  #onVehicleClick: ((id: string) => void) | null = null;

  /**
   * Resolves once the style is up and the map can take data. The library is
   * imported here so its ~900 kB land in a lazy chunk instead of the initial
   * bundle. Rejects if the chunk or the style fails to load.
   */
  async create(container: HTMLElement): Promise<void> {
    const { Map, AttributionControl, NavigationControl } =
      await import('maplibre-gl');

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
    this.#readyMap?.setFilter(
      SELECTED_LAYER,
      id === null ? MATCHES_NOTHING : ['==', ['get', 'id'], id]
    );
  }

  /** Registered once in `create()`; the handler is what changes. */
  onVehicleClick(handler: (id: string) => void): void {
    this.#onVehicleClick = handler;
  }

  destroy(): void {
    this.#map?.remove();
    this.#map = null;
    this.#loaded = false;
    this.#onVehicleClick = null;
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
        'circle-stroke-color': SELECTION_COLOR,
        'circle-stroke-width': 3,
      },
    });

    this.#bindInteractions(map);
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
