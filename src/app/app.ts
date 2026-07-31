import { Component, inject } from '@angular/core';
import { MapComponent } from './features/map/map.component';
import { VehicleStore } from './core/state/vehicle-store';

@Component({
  selector: 'app-root',
  imports: [MapComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly store = inject(VehicleStore);

  constructor() {
    this.store.start();
  }
}
