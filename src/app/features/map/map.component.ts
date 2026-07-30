import {
  afterNextRender,
  Component,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  viewChild,
} from '@angular/core';
import { MapLibreService } from '../../core/map/maplibre.service';
import { toFeatureCollection } from '../../core/map/vehicle-geojson';
import { VehicleStore } from '../../core/state/vehicle-store';

/**
 * The bridge between the store's signals and the map's imperative API. It
 * holds no map object of its own: its whole map vocabulary is the service.
 */
@Component({
  selector: 'app-map',
  template: `<div class="map" #container></div>`,
  styles: `
    :host {
      display: block;
      block-size: 100%;
      position: relative;
    }

    .map {
      block-size: 100%;
    }
  `,
})
export class MapComponent implements OnDestroy {
  readonly #maplibre = inject(MapLibreService);
  readonly #store = inject(VehicleStore);
  // Not an ES private field: signal queries are not allowed on one.
  private readonly container =
    viewChild.required<ElementRef<HTMLElement>>('container');

  constructor() {
    afterNextRender(() => void this.#create());

    // Before the map has loaded this is a no-op; `#create` pushes the
    // snapshot that landed meanwhile, so nothing waits for the next tick.
    effect(() =>
      this.#maplibre.setVehicles(toFeatureCollection(this.#store.vehicles()))
    );
  }

  ngOnDestroy(): void {
    this.#maplibre.destroy();
  }

  async #create(): Promise<void> {
    try {
      await this.#maplibre.create(this.container().nativeElement);
      this.#maplibre.setVehicles(toFeatureCollection(this.#store.vehicles()));
    } catch (error) {
      // This spec ships no error UI; the shell spec owns loading and error.
      console.error('The map failed to load', error);
    }
  }
}
