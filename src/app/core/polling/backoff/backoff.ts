const BASE_DELAY_MS = 1_000;

/** Inert at three attempts; it is the ceiling if the retry count ever rises. */
const MAX_DELAY_MS = 30_000;

/** ±20% spread, so `random()` of 0.5 yields exactly the nominal delay. */
const JITTER = 0.2;

/**
 * Exponential backoff for a zero-based attempt: 1s, 2s, 4s, capped and
 * jittered. `random` is injected so the delays are exact under test.
 */
export function backoffDelay(attempt: number, random: () => number): number {
  const nominal = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  return Math.round(nominal * (1 - JITTER + 2 * JITTER * random()));
}
