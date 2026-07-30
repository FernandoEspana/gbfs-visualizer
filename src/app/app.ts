import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { VehicleStore } from './core/state/vehicle-store';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly title = signal('gbfs-visualizer');

  protected readonly store = inject(VehicleStore);

  constructor() {
    this.store.start();
  }
}
