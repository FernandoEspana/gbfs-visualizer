import {
  afterNextRender,
  Component,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  viewChild,
} from '@angular/core';
import { MapLibreService } from '@core/map/maplibre.service';
import {
  toFeatureCollection,
  type VehicleCollection,
} from '@core/map/vehicle-geojson/vehicle-geojson';
import { VehicleStore } from '@core/state/vehicle-store/vehicle-store';
import { MapLegendComponent } from '../map-legend/map-legend.component';

/**
 * The bridge between the store's signals and the map's imperative API. It
 * holds no map object of its own: its whole map vocabulary is the service.
 */
@Component({
  selector: 'app-map',
  imports: [MapLegendComponent],
  template: `
    <div class="map" #container></div>
    <app-map-legend />
  `,
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

  #mapReady = false;
  #fitted = false;

  constructor() {
    afterNextRender(() => void this.#create());

    // Before the map has loaded this is a no-op; `#create` pushes the
    // snapshot that landed meanwhile, so nothing waits for the next tick.
    effect(() => {
      const collection = toFeatureCollection(this.#store.vehicles());
      this.#maplibre.setVehicles(collection);
      this.#fitOnce(collection);
    });

    // A selection is a filter on a layer, so it never touches the source.
    effect(() =>
      this.#maplibre.setSelected(this.#store.selected()?.id ?? null)
    );

    this.#maplibre.onVehicleClick(id => this.#store.select(id));
  }

  ngOnDestroy(): void {
    this.#maplibre.destroy();
  }

  async #create(): Promise<void> {
    try {
      await this.#maplibre.create(this.container().nativeElement);
      this.#mapReady = true;

      const collection = toFeatureCollection(this.#store.vehicles());
      this.#maplibre.setVehicles(collection);
      this.#fitOnce(collection);
    } catch (error) {
      // This spec ships no error UI; the shell spec owns loading and error.
      console.error('The map failed to load', error);
    }
  }

  /**
   * The data frames the camera once. An empty first snapshot does not spend
   * the one fit, and no later tick moves a viewport the user may have panned.
   */
  #fitOnce(collection: VehicleCollection): void {
    if (this.#fitted || !this.#mapReady || collection.features.length === 0) {
      return;
    }

    this.#fitted = true;
    this.#maplibre.fitToData(collection);
  }
}
