import { HALO_PERIOD_MS, HALO_RESTING_FRAME, haloFrame } from './halo-pulse';

describe('haloFrame', () => {
  it('starts tight and opaque', () => {
    const first = haloFrame(0);
    const later = haloFrame(HALO_PERIOD_MS / 2);

    expect(first.radius).toBeLessThan(later.radius);
    expect(first.opacity).toBeGreaterThan(later.opacity);
  });

  it('ends wide and faded out', () => {
    const last = haloFrame(HALO_PERIOD_MS - 1);

    expect(last.radius).toBeGreaterThan(haloFrame(0).radius);
    expect(last.opacity).toBeCloseTo(0);
  });

  it('repeats every period', () => {
    for (const elapsed of [0, 200, 800, 1_599]) {
      expect(haloFrame(elapsed + HALO_PERIOD_MS)).toEqual(haloFrame(elapsed));
      expect(haloFrame(elapsed + 10 * HALO_PERIOD_MS)).toEqual(
        haloFrame(elapsed)
      );
    }
  });

  it('grows without ever shrinking inside a period', () => {
    let previous = haloFrame(0);

    for (let elapsed = 16; elapsed < HALO_PERIOD_MS; elapsed += 16) {
      const frame = haloFrame(elapsed);

      expect(frame.radius).toBeGreaterThanOrEqual(previous.radius);
      expect(frame.opacity).toBeLessThanOrEqual(previous.opacity);
      previous = frame;
    }
  });

  it('never emits a negative radius or opacity', () => {
    for (let elapsed = 0; elapsed <= 3 * HALO_PERIOD_MS; elapsed += 7) {
      const frame = haloFrame(elapsed);

      expect(frame.radius).toBeGreaterThan(0);
      expect(frame.opacity).toBeGreaterThanOrEqual(0);
      expect(frame.opacity).toBeLessThanOrEqual(1);
    }
  });

  it('treats a time before the start as the first instant', () => {
    // A clock that runs backwards must not wrap into a huge radius.
    expect(haloFrame(-1)).toEqual(haloFrame(0));
    expect(haloFrame(-HALO_PERIOD_MS * 3)).toEqual(haloFrame(0));
  });
});

describe('HALO_RESTING_FRAME', () => {
  it('is a frame of the same pulse', () => {
    expect(HALO_RESTING_FRAME.radius).toBeGreaterThan(haloFrame(0).radius);
    expect(HALO_RESTING_FRAME.radius).toBeLessThan(
      haloFrame(HALO_PERIOD_MS - 1).radius
    );
  });

  it('stays visible, since it is all a reduced-motion user gets', () => {
    expect(HALO_RESTING_FRAME.opacity).toBeGreaterThan(0.15);
  });
});
