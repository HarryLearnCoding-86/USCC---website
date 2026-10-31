// src/app/api/users/[userId]/route.ts
// PATCH /api/users/:userId — deactivate, reactivate or reset the password of an account (SRS-AUTH-07, 08).
// TECHNICAL only; requires an Idempotency-Key header.

import { updateUserInputSchema } from "@/server/auth/account-input-schemas";
import { createApiRouteHandler } from "@/server/http/api-route-handler";
import { updateUserAccount } from "@/server/services/user-account-service";

/**
 * Applies { isActive } or { newPassword } to one account.
 *
 * @returns 200 { user }; 400 invalid body; 404 USER_NOT_FOUND;
 *   409 LAST_ACTIVE_TECHNICAL or SELF_DEACTIVATION; 401/403 per guards.
 */
export const PATCH = createApiRouteHandler<{ userId: string }>(
  "MANAGE_ACCOUNTS",
  async ({ requestBody, routeParams, signedInUser, database }) => {
    const updateUserInput = updateUserInputSchema.parse(requestBody);
    const user = await updateUserAccount(signedInUser.id, routeParams.userId, updateUserInput, database);
    return { status: 200, body: { user: { ...user } } };
  },
);
