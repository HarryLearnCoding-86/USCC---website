// src/server/domain/login-throttle-rules.ts
// SRS-AUTH-05: after 5 failed logins for one username within 10 minutes, further attempts for that username are
// blocked for 10 minutes (thresholds are open question OI-06). Only failures after the last successful login count,
// and attempts made while locked are not recorded, so a lock cannot be extended forever by an attacker.
// Pure: callers pass the recent attempts and the current time.

/** SRS-AUTH-05 thresholds. */
export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_FAILURE_WINDOW_MILLISECONDS = 10 * 60 * 1000;
export const LOGIN_LOCK_DURATION_MILLISECONDS = 10 * 60 * 1000;
/** How far back attempts must be loaded to evaluate a lock. */
export const LOGIN_ATTEMPT_LOOKBACK_MILLISECONDS = LOGIN_FAILURE_WINDOW_MILLISECONDS + LOGIN_LOCK_DURATION_MILLISECONDS;

/** One recorded attempt. */
export interface RecordedLoginAttempt {
  wasSuccessful: boolean;
  attemptedAt: Date;
}

/** Lock state of a username. */
export type LoginLockState = { isLocked: false } | { isLocked: true; lockedUntil: Date; retryAfterSeconds: number };

/**
 * Evaluates whether a username is currently locked.
 *
 * @param recentAttempts - Attempts for the username within the lookback period, any order.
 * @param now - Current time.
 * @returns Unlocked, or locked with the time the lock ends.
 */
export function evaluateLoginLock(recentAttempts: readonly RecordedLoginAttempt[], now: Date): LoginLockState {
  const attemptsInOrder = [...recentAttempts].sort((first, second) => first.attemptedAt.getTime() - second.attemptedAt.getTime());
  const lastSuccessIndex = attemptsInOrder.map((attempt) => attempt.wasSuccessful).lastIndexOf(true);
  const failureTimes = attemptsInOrder
    .slice(lastSuccessIndex + 1)
    .filter((attempt) => !attempt.wasSuccessful)
    .map((attempt) => attempt.attemptedAt.getTime());

  // Any run of LOGIN_FAILURE_LIMIT failures inside one window starts a lock from its last failure.
  let lockedUntilTime = 0;
  for (let windowStart = 0; windowStart + LOGIN_FAILURE_LIMIT - 1 < failureTimes.length; windowStart++) {
    const firstFailureTime = failureTimes[windowStart] as number;
    const lastFailureTime = failureTimes[windowStart + LOGIN_FAILURE_LIMIT - 1] as number;
    if (lastFailureTime - firstFailureTime <= LOGIN_FAILURE_WINDOW_MILLISECONDS) {
      lockedUntilTime = Math.max(lockedUntilTime, lastFailureTime + LOGIN_LOCK_DURATION_MILLISECONDS);
    }
  }
  if (lockedUntilTime <= now.getTime()) {
    return { isLocked: false };
  }
  return {
    isLocked: true,
    lockedUntil: new Date(lockedUntilTime),
    retryAfterSeconds: Math.ceil((lockedUntilTime - now.getTime()) / 1000),
  };
}
