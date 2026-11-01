// src/server/domain/retry-backoff.ts
// Exponential backoff shared by the SSE reconnect loop (AGENT_PROMPT.md §3.6) and the offline queue retries
// (SRS-SYNC-01) and the server-side PostgreSQL listener: 1 s, 2 s, 4 s … capped at 30 s. Pure.

/** First retry delay. */
export const INITIAL_RETRY_DELAY_MILLISECONDS = 1_000;
/** Longest retry delay. */
export const MAXIMUM_RETRY_DELAY_MILLISECONDS = 30_000;

/**
 * Delay before the next retry.
 *
 * @param failedAttemptCount - Consecutive failures so far (0 for the first retry).
 * @returns Milliseconds to wait: 1000 × 2^failedAttemptCount, at most 30000.
 */
export function computeRetryDelayMilliseconds(failedAttemptCount: number): number {
  const safeAttemptCount = Math.max(0, Math.min(failedAttemptCount, 30));
  return Math.min(INITIAL_RETRY_DELAY_MILLISECONDS * 2 ** safeAttemptCount, MAXIMUM_RETRY_DELAY_MILLISECONDS);
}
