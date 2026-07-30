import { Service } from '@angular/core';
import type { Map as MapLibreMap } from 'maplibre-gl';

/** Keyless vector tiles. Light enough for the vehicles to carry the weight. */
const STYLE_URL =
  'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

/** Centre of the feed's Queens/Bronx bounds, so the first paint is not empty. */
const INITIAL_CENTER: [number, number] = [-73.814, 40.788];
const INITIAL_ZOOM = 10.5;

/**
 * The only module in the repo allowed to name `maplibre-gl`. It owns the map,
 * its source and its layers; callers speak GeoJSON and vehicle ids, never
 * MapLibre objects.
 */
@Service()
export class MapLibreService {
  #map: MapLibreMap | null = null;

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
  }

  destroy(): void {
    this.#map?.remove();
    this.#map = null;
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
