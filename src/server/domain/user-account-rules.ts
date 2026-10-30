// src/server/domain/user-account-rules.ts
// Pure business rules for account activation changes, kept free of the database so they are unit-testable.
// SRS-AUTH-08: the last active TECHNICAL account can never be deactivated, otherwise nobody could
// manage accounts or tournaments any more without developer help (BR-16).

import type { Role } from "@prisma/client";

/** Why a deactivation is refused. */
export type DeactivationRefusalReason = "LAST_ACTIVE_TECHNICAL" | "SELF_DEACTIVATION";

/** Facts needed to decide whether an account may be deactivated. */
export interface DeactivationContext {
  /** ID of the TD performing the action. */
  actingUserId: string;
  /** ID of the account to deactivate. */
  targetUserId: string;
  /** Role of the account to deactivate. */
  targetRole: Role;
  /** Whether the target is currently active; deactivating an inactive account is a no-op. */
  isTargetActive: boolean;
  /** Number of active TECHNICAL accounts, including the target if it is one. */
  activeTechnicalAccountCount: number;
}

/**
 * Decides whether an account may be deactivated.
 *
 * @param context - Current facts about the actor, the target and the remaining TDs.
 * @returns null when allowed, otherwise the reason for refusal.
 */
export function findDeactivationRefusalReason(
  context: DeactivationContext,
): DeactivationRefusalReason | null {
  if (!context.isTargetActive) {
    return null;
  }
  // A TD locking themselves out mid-tournament is almost always a mis-tap; another TD can do it.
  if (context.actingUserId === context.targetUserId) {
    return "SELF_DEACTIVATION";
  }
  if (context.targetRole === "TECHNICAL" && context.activeTechnicalAccountCount <= 1) {
    return "LAST_ACTIVE_TECHNICAL";
  }
  return null;
}
