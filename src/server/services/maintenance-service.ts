// src/server/services/maintenance-service.ts
// Periodic housekeeping, run hourly by src/instrumentation.ts: deletes expired sessions, idempotency records past
// their 48 h retention (SRS §9), and login attempts too old to affect a lockout (SRS-AUTH-05). Audit events,
// results and imports are never touched (SRS-AUD-02).

import { prisma } from "@/server/database/prisma-client";
import { LOGIN_ATTEMPT_LOOKBACK_MILLISECONDS } from "@/server/domain/login-throttle-rules";
import { logServerEvent } from "@/server/observability/server-logger";
import { deleteExpiredIdempotencyRecords } from "@/server/services/idempotency-service";

/** Login attempts are kept a day for diagnostics, far longer than the lockout needs. */
const LOGIN_ATTEMPT_RETENTION_MILLISECONDS = Math.max(24 * 60 * 60 * 1000, LOGIN_ATTEMPT_LOOKBACK_MILLISECONDS);

/** Rows removed in one run. */
export interface MaintenanceSummary {
  expiredSessionCount: number;
  expiredIdempotencyRecordCount: number;
  oldLoginAttemptCount: number;
}

/**
 * Runs one maintenance pass.
 *
 * @param now - Current time; injectable for tests.
 * @returns Counts of deleted rows.
 */
export async function runMaintenance(now: Date = new Date()): Promise<MaintenanceSummary> {
  const expiredSessions = await prisma.session.deleteMany({ where: { expiresAt: { lte: now } } });
  const expiredIdempotencyRecordCount = await deleteExpiredIdempotencyRecords(now);
  const oldLoginAttempts = await prisma.loginAttempt.deleteMany({
    where: { attemptedAt: { lt: new Date(now.getTime() - LOGIN_ATTEMPT_RETENTION_MILLISECONDS) } },
  });
  const summary = {
    expiredSessionCount: expiredSessions.count,
    expiredIdempotencyRecordCount,
    oldLoginAttemptCount: oldLoginAttempts.count,
  };
  logServerEvent("info", "maintenance.completed", { ...summary });
  return summary;
}
