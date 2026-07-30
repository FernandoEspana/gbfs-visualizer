import { Service } from '@angular/core';
import type { FeatureCollection, Point } from 'geojson';
import type {
  DataDrivenPropertyValueSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
} from 'maplibre-gl';
import { RANGE_BUCKETS, UNKNOWN_RANGE_COLOR } from './range-buckets';
import type { VehicleFeatureProperties } from './vehicle-geojson';

type VehicleCollection = FeatureCollection<Point, VehicleFeatureProperties>;

/** Keyless vector tiles. Light enough for the vehicles to carry the weight. */
const STYLE_URL =
  'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

/** Centre of the feed's Queens/Bronx bounds, so the first paint is not empty. */
const INITIAL_CENTER: [number, number] = [-73.814, 40.788];
const INITIAL_ZOOM = 10.5;

const VEHICLES_SOURCE = 'vehicles';
const VEHICLES_LAYER = 'vehicles';

const EMPTY_COLLECTION: VehicleCollection = {
  type: 'FeatureCollection',
  features: [],
};

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

  destroy(): void {
    this.#map?.remove();
    this.#map = null;
    this.#loaded = false;
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
