import {
  formatCoordinates,
  formatRange,
  formatRelativeTime,
} from './vehicle-format';

const NOW_MS = 1_700_000_000_000;

describe('formatRange', () => {
  it('names a missing range instead of rendering it as zero', () => {
    expect(formatRange(undefined)).toBe('no data');
  });

  it('stays in metres under a kilometre', () => {
    expect(formatRange(340)).toBe('340 m');
  });

  it('renders a reported zero as metres, not as no data', () => {
    expect(formatRange(0)).toBe('0 m');
  });

  it('switches to kilometres at exactly one kilometre', () => {
    expect(formatRange(999)).toBe('999 m');
    expect(formatRange(1_000)).toBe('1.0 km');
  });

  it('keeps one decimal above a kilometre', () => {
    expect(formatRange(18_400)).toBe('18.4 km');
    expect(formatRange(18_449)).toBe('18.4 km');
    expect(formatRange(38_950)).toBe('39.0 km');
  });

  it('rounds fractional metres to whole metres', () => {
    expect(formatRange(340.6)).toBe('341 m');
  });
});

describe('formatRelativeTime', () => {
  it('reads as just now under a minute', () => {
    expect(formatRelativeTime(NOW_MS - 59_999, NOW_MS)).toBe('just now');
  });

  it('reads as just now when the feed clock runs ahead of the browser', () => {
    expect(formatRelativeTime(NOW_MS + 30_000, NOW_MS)).toBe('just now');
  });

  it('counts whole minutes from exactly one minute', () => {
    expect(formatRelativeTime(NOW_MS - 60_000, NOW_MS)).toBe('1 min ago');
    expect(formatRelativeTime(NOW_MS - 150_000, NOW_MS)).toBe('2 min ago');
    expect(formatRelativeTime(NOW_MS - 59 * 60_000, NOW_MS)).toBe('59 min ago');
  });

  it('counts whole hours from exactly one hour', () => {
    expect(formatRelativeTime(NOW_MS - 3_600_000, NOW_MS)).toBe('1 h ago');
    expect(formatRelativeTime(NOW_MS - 3 * 3_600_000 - 60_000, NOW_MS)).toBe(
      '3 h ago'
    );
  });
});

describe('formatCoordinates', () => {
  it('emits lat then lon at five decimals', () => {
    expect(formatCoordinates({ lat: 40.71234, lon: -73.85678 })).toBe(
      '40.71234, -73.85678'
    );
  });

  it('pads a short value out to five decimals', () => {
    expect(formatCoordinates({ lat: 40.7, lon: -73.8 })).toBe(
      '40.70000, -73.80000'
    );
  });

  it('rounds anything more precise than the feed', () => {
    expect(formatCoordinates({ lat: 40.7123456, lon: -73.8567891 })).toBe(
      '40.71235, -73.85679'
    );
  });
});
