// src/app/api/users/route.ts
// GET /api/users — list arbiter accounts; POST /api/users — create one (SRS-AUTH-02, BR-16).
// TECHNICAL only. POST requires an Idempotency-Key header.

import { createUserInputSchema } from "@/server/auth/account-input-schemas";
import { createApiRouteHandler } from "@/server/http/api-route-handler";
import { createUserAccount, listUserAccounts } from "@/server/services/user-account-service";

/**
 * Lists all accounts.
 *
 * @returns 200 { users: UserAccountSummary[] }; 401/403 per guards.
 */
export const GET = createApiRouteHandler("MANAGE_ACCOUNTS", async ({ database }) => {
  const users = await listUserAccounts(database);
  return { status: 200, body: { users: users.map((user) => ({ ...user })) } };
});

/**
 * Creates an account from { username, password, role }.
 *
 * @returns 201 { user }; 400 invalid body; 409 USERNAME_TAKEN; 401/403 per guards.
 */
export const POST = createApiRouteHandler("MANAGE_ACCOUNTS", async ({ requestBody, database }) => {
  const createUserInput = createUserInputSchema.parse(requestBody);
  const user = await createUserAccount(createUserInput, database);
  return { status: 201, body: { user: { ...user } } };
});
