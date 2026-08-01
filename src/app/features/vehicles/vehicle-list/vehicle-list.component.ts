import {
  CdkVirtualScrollViewport,
  ScrollingModule,
} from '@angular/cdk/scrolling';
import {
  afterNextRender,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
  type TrackByFunction,
} from '@angular/core';
import {
  bucketFor,
  UNKNOWN_RANGE_COLOR,
} from '@core/map/range-buckets/range-buckets';
import type { Vehicle } from '@core/models/vehicle.model';
import { NOW } from '@core/time/now';
import { formatRange, formatRelativeTime } from '@core/format/vehicle-format';

/** The promise `itemSize` makes to the viewport. Fixed in CSS, never wrapped. */
const ROW_HEIGHT_PX = 64;

/**
 * Every vehicle in the feed, as a listbox. Presentational: it reads two inputs
 * and emits an id, so nothing here knows the store or the map exists.
 */
@Component({
  selector: 'app-vehicle-list',
  imports: [ScrollingModule],
  templateUrl: './vehicle-list.component.html',
  styleUrl: './vehicle-list.component.css',
})
export class VehicleListComponent {
  readonly vehicles = input.required<readonly Vehicle[]>();
  readonly selected = input<Vehicle | undefined>(undefined);
  // Named for the domain, not for the DOM. The rule guards against shadowing a
  // native `select` event, which only inputs and textareas emit — this list has
  // neither, so nothing can reach the host and be mistaken for this output.
  // eslint-disable-next-line @angular-eslint/no-output-native
  readonly select = output<string>();

  readonly #now = inject(NOW);
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);

  // Not an ES private field: signal queries are not allowed on one.
  private readonly viewport = viewChild.required(CdkVirtualScrollViewport);

  /** Where the selection about to arrive came from. Not a derived value. */
  readonly #scrollOrigin = signal<'self' | 'external'>('external');

  /** The last id scrolled to, so an unchanged selection is never re-scrolled. */
  #lastScrolledId: string | null = null;

  /** The keyboard cursor. Where `aria-activedescendant` points, not a selection. */
  readonly #activeIndex = signal(0);

  protected readonly rowHeight = ROW_HEIGHT_PX;

  constructor() {
    afterNextRender(() => this.#hideScrollWrapper());
    effect(() => this.#revealSelected(this.selected()?.id));
  }

  protected readonly trackById: TrackByFunction<Vehicle> = (_, vehicle) =>
    vehicle.id;

  /** Marks the next selection as this list's own, then asks for it. */
  protected onRowClick(id: string, index: number): void {
    this.#activeIndex.set(index);
    this.#scrollOrigin.set('self');
    this.select.emit(id);
  }

  protected isActive(index: number): boolean {
    return index === this.#activeIndex();
  }

  /** Null rather than a dangling id when there is nothing to point at. */
  protected activeDescendantId(): string | null {
    const active = this.vehicles()[this.#activeIndex()];
    return active === undefined ? null : `vehicle-option-${active.id}`;
  }

  /**
   * The listbox is the tab stop and the only element that ever holds focus, so
   * every key the pattern defines is handled here. Rows are named by
   * `aria-activedescendant`, never focused.
   */
  protected onKeydown(event: KeyboardEvent): void {
    const count = this.vehicles().length;
    if (count === 0) {
      return;
    }

    // A shrinking feed can leave the cursor past the end.
    const active = Math.min(this.#activeIndex(), count - 1);
    let next: number;

    switch (event.key) {
      case 'ArrowDown':
        next = Math.min(active + 1, count - 1);
        break;
      case 'ArrowUp':
        next = Math.max(active - 1, 0);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = count - 1;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.#selectAt(active);
        return;
      default:
        return;
    }

    // Only once a key is known to be ours: anything else stays the browser's.
    event.preventDefault();
    this.#activeIndex.set(next);
    this.#keepVisible(next);
  }

  /** Re-establishes the invariant that the active row is a rendered row. */
  protected onFocus(): void {
    this.#keepVisible(this.#activeIndex());
  }

  #selectAt(index: number): void {
    const vehicle = this.vehicles()[index];
    if (vehicle !== undefined) {
      this.onRowClick(vehicle.id, index);
    }
  }

  /**
   * Scrolls the minimum needed to bring a row inside the viewport, so arrowing
   * through neighbours does not jump the list to put each one at the top.
   */
  #keepVisible(index: number): void {
    const viewport = this.viewport();
    const offset = viewport.measureScrollOffset();
    const size = viewport.getViewportSize();
    const rowStart = index * ROW_HEIGHT_PX;
    const rowEnd = rowStart + ROW_HEIGHT_PX;

    if (rowStart < offset) {
      viewport.scrollToOffset(rowStart);
    } else if (rowEnd > offset + size) {
      viewport.scrollToOffset(rowEnd - size);
    }
  }

  /**
   * `selected()` resolves against the live snapshot, so it is a new object on
   * every tick. Only a change of id is a real selection change; everything else
   * would scroll the viewport out from under a user who had scrolled away.
   */
  #revealSelected(id: string | undefined): void {
    if (id === undefined) {
      this.#lastScrolledId = null;
      return;
    }

    if (id === this.#lastScrolledId) {
      return;
    }

    this.#lastScrolledId = id;

    // Read untracked: this is a guard the list itself sets, not an input it
    // reacts to, and tracking it here would re-run the effect on its own reset.
    if (untracked(this.#scrollOrigin) === 'self') {
      this.#scrollOrigin.set('external');
      return;
    }

    const index = untracked(this.vehicles).findIndex(
      vehicle => vehicle.id === id
    );
    if (index !== -1) {
      // The keyboard cursor follows the last interaction, wherever it came
      // from, so arrowing on from a map selection starts at that vehicle.
      this.#activeIndex.set(index);
      this.viewport().scrollToIndex(index, 'smooth');
    }
  }

  protected dotColor(vehicle: Vehicle): string {
    return bucketFor(vehicle.currentRangeMeters)?.color ?? UNKNOWN_RANGE_COLOR;
  }

  protected range(vehicle: Vehicle): string {
    return formatRange(vehicle.currentRangeMeters);
  }

  protected reportedAt(vehicle: Vehicle): string {
    const reported = vehicle.lastReported;
    return reported === undefined
      ? 'no data'
      : formatRelativeTime(reported, this.#now());
  }

  /**
   * The viewport injects a wrapper between itself and the rows, which would
   * otherwise sit between `listbox` and `option` and break the ARIA
   * relationship. Marking it presentational makes it transparent to the
   * accessibility tree.
   */
  #hideScrollWrapper(): void {
    this.#host.nativeElement
      .querySelector('.cdk-virtual-scroll-content-wrapper')
      ?.setAttribute('role', 'presentation');
  }
}
