// src/server/services/user-account-service.ts
// Account management use cases for /admin/users (SRS-AUTH-02, SRS-AUTH-07, SRS-AUTH-08, BR-16):
// list, create, deactivate / reactivate, and reset password. Deactivation and password resets end
// the target's sessions in the same transaction as the change.

import type { Role } from "@prisma/client";
import { vi } from "@/i18n/vi";
import { prisma } from "@/server/database/prisma-client";
import type { DatabaseClient } from "@/server/database/database-client";
import { hashPassword } from "@/server/auth/password-hasher";
import { deleteAllSessionsForUser } from "@/server/auth/session-store";
import type { CreateUserInput, UpdateUserInput } from "@/server/auth/account-input-schemas";
import { findDeactivationRefusalReason } from "@/server/domain/user-account-rules";
import { ApiError } from "@/server/http/api-error";
import { isUniqueConstraintViolation } from "@/server/services/idempotency-service";

/** Account fields safe to send to the browser; never includes the password hash. */
export interface UserAccountSummary {
  id: string;
  username: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

const USER_SUMMARY_SELECTION = {
  id: true,
  username: true,
  role: true,
  isActive: true,
  createdAt: true,
} as const;

/**
 * Converts a user row to its public summary.
 *
 * @param user - Row selected with USER_SUMMARY_SELECTION.
 * @returns The summary with createdAt as an ISO string (JSON-safe).
 */
function toUserAccountSummary(user: {
  id: string;
  username: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
}): UserAccountSummary {
  return { ...user, createdAt: user.createdAt.toISOString() };
}

/**
 * Lists all arbiter accounts, active first, then by username.
 *
 * @param database - Optional transaction client.
 * @returns Account summaries.
 */
export async function listUserAccounts(database: DatabaseClient = prisma): Promise<UserAccountSummary[]> {
  const users = await database.user.findMany({
    select: USER_SUMMARY_SELECTION,
    orderBy: [{ isActive: "desc" }, { username: "asc" }],
  });
  return users.map(toUserAccountSummary);
}

/**
 * Creates an arbiter account. There is no self-registration: only this TD-guarded path creates users.
 *
 * @param createUserInput - Validated username, password and role.
 * @param database - Transaction client of the request.
 * @returns The new account's summary.
 * @throws ApiError 409 USERNAME_TAKEN when the username exists.
 */
export async function createUserAccount(
  createUserInput: CreateUserInput,
  database: DatabaseClient = prisma,
): Promise<UserAccountSummary> {
  const passwordHash = await hashPassword(createUserInput.password);
  try {
    const user = await database.user.create({
      data: { username: createUserInput.username, passwordHash, role: createUserInput.role },
      select: USER_SUMMARY_SELECTION,
    });
    return toUserAccountSummary(user);
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new ApiError(409, "USERNAME_TAKEN", vi.adminUsers.usernameTaken);
    }
    throw error;
  }
}

/**
 * Applies one account change: activation toggle or password reset.
 *
 * @param actingUserId - The TD performing the change.
 * @param targetUserId - The account being changed.
 * @param updateUserInput - Either { isActive } or { newPassword }.
 * @param database - Transaction client; the caller must run this inside a transaction so the
 *   row locks taken for the last-TD check hold until commit.
 * @returns The updated account's summary.
 * @throws ApiError 404 USER_NOT_FOUND, 409 LAST_ACTIVE_TECHNICAL, 409 SELF_DEACTIVATION.
 */
export async function updateUserAccount(
  actingUserId: string,
  targetUserId: string,
  updateUserInput: UpdateUserInput,
  database: DatabaseClient,
): Promise<UserAccountSummary> {
  const targetUser = await database.user.findUnique({ where: { id: targetUserId } });
  if (!targetUser) {
    throw new ApiError(404, "USER_NOT_FOUND", vi.adminUsers.userNotFound);
  }

  if ("newPassword" in updateUserInput) {
    const passwordHash = await hashPassword(updateUserInput.newPassword);
    const updatedUser = await database.user.update({
      where: { id: targetUserId },
      data: { passwordHash },
      select: USER_SUMMARY_SELECTION,
    });
    // Old sessions may belong to whoever knew the old password; end them.
    await deleteAllSessionsForUser(targetUserId, database);
    return toUserAccountSummary(updatedUser);
  }

  if (!updateUserInput.isActive) {
    await assertDeactivationAllowed(actingUserId, targetUser, database);
  }
  const updatedUser = await database.user.update({
    where: { id: targetUserId },
    data: { isActive: updateUserInput.isActive },
    select: USER_SUMMARY_SELECTION,
  });
  if (!updateUserInput.isActive) {
    // SRS-AUTH-07: a deactivated user's sessions end immediately.
    await deleteAllSessionsForUser(targetUserId, database);
  }
  return toUserAccountSummary(updatedUser);
}

/**
 * Enforces SRS-AUTH-08 and the self-deactivation guard.
 * Locks all active TECHNICAL rows first, so two TDs deactivating each other at the same moment
 * cannot both succeed and leave zero active TDs.
 *
 * @param actingUserId - The TD performing the change.
 * @param targetUser - The account being deactivated.
 * @param database - Transaction client.
 * @throws ApiError 409 when the rule refuses the deactivation.
 */
async function assertDeactivationAllowed(
  actingUserId: string,
  targetUser: { id: string; role: Role; isActive: boolean },
  database: DatabaseClient,
): Promise<void> {
  const lockedActiveTechnicalUsers = await database.$queryRaw<{ id: string }[]>`
    SELECT id FROM users WHERE role = 'TECHNICAL' AND is_active = true FOR UPDATE`;
  const refusalReason = findDeactivationRefusalReason({
    actingUserId,
    targetUserId: targetUser.id,
    targetRole: targetUser.role,
    isTargetActive: targetUser.isActive,
    activeTechnicalAccountCount: lockedActiveTechnicalUsers.length,
  });
  if (refusalReason === "LAST_ACTIVE_TECHNICAL") {
    throw new ApiError(409, refusalReason, vi.adminUsers.lastTechnicalAccount);
  }
  if (refusalReason === "SELF_DEACTIVATION") {
    throw new ApiError(409, refusalReason, vi.adminUsers.cannotDeactivateSelf);
  }
}
