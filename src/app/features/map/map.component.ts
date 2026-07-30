import {
  afterNextRender,
  Component,
  ElementRef,
  inject,
  OnDestroy,
  viewChild,
} from '@angular/core';
import { MapLibreService } from '../../core/map/maplibre.service';

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
  // Not an ES private field: signal queries are not allowed on one.
  private readonly container =
    viewChild.required<ElementRef<HTMLElement>>('container');

  constructor() {
    afterNextRender(() => void this.#create());
  }

  ngOnDestroy(): void {
    this.#maplibre.destroy();
  }

  async #create(): Promise<void> {
    try {
      await this.#maplibre.create(this.container().nativeElement);
    } catch (error) {
      // This spec ships no error UI; the shell spec owns loading and error.
      console.error('The map failed to load', error);
    }
  }
}
