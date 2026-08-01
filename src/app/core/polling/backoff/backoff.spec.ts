import { backoffDelay } from './backoff';

const noJitter = () => 0.5;

describe('backoffDelay', () => {
  it('doubles the delay on each attempt', () => {
    expect(backoffDelay(0, noJitter)).toBe(1000);
    expect(backoffDelay(1, noJitter)).toBe(2000);
    expect(backoffDelay(2, noJitter)).toBe(4000);
  });

  it('caps the delay at 30 seconds', () => {
    expect(backoffDelay(10, noJitter)).toBe(30_000);
    expect(backoffDelay(50, noJitter)).toBe(30_000);
  });

  it('spreads the delay by 20% in each direction', () => {
    expect(backoffDelay(0, () => 0)).toBe(800);
    expect(backoffDelay(0, () => 1)).toBe(1200);
  });

  it('applies the jitter after the cap', () => {
    expect(backoffDelay(10, () => 0)).toBe(24_000);
    expect(backoffDelay(10, () => 1)).toBe(36_000);
  });
});
