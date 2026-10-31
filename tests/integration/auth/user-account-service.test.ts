// tests/integration/auth/user-account-service.test.ts
// Integration tests for account management (SRS-AUTH-02, 07, 08): create, duplicate usernames,
// last-TD protection, self-deactivation, and session termination on deactivation / password reset.

import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/database/prisma-client";
import { ApiError } from "@/server/http/api-error";
import { loginWithPassword } from "@/server/services/authentication-service";
import { createUserAccount, updateUserAccount } from "@/server/services/user-account-service";
import { createFixtureUser, FIXTURE_PASSWORD, wipeTestDatabase } from "../../helpers/test-database";

const requestMetadata = { userAgent: "vitest", ipAddress: null };

/**
 * Runs updateUserAccount in a transaction, as the route handler does.
 *
 * @param actingUserId - TD performing the change.
 * @param targetUserId - Account being changed.
 * @param change - The update body.
 * @returns The updated summary.
 */
function updateInTransaction(
  actingUserId: string,
  targetUserId: string,
  change: { isActive: boolean } | { newPassword: string },
) {
  return prisma.$transaction((transaction) => updateUserAccount(actingUserId, targetUserId, change, transaction));
}

/**
 * Asserts that a promise rejects with an ApiError of the given status and code.
 *
 * @param operation - Promise expected to reject.
 * @param httpStatus - Expected status.
 * @param code - Expected error code.
 */
async function expectApiError(operation: Promise<unknown>, httpStatus: number, code: string) {
  const error = await operation.catch((caughtError: unknown) => caughtError);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ httpStatus, code });
}

describe("user account management", () => {
  beforeEach(async () => {
    await wipeTestDatabase();
  });

  it("creates an account whose password works and is never returned", async () => {
    const createdUser = await createUserAccount({ username: "new_recorder", password: "New-Password-1", role: "RECORDER" });
    expect(createdUser).toMatchObject({ username: "new_recorder", role: "RECORDER", isActive: true });
    expect(createdUser).not.toHaveProperty("passwordHash");
    const loginOutcome = await loginWithPassword({ username: "new_recorder", password: "New-Password-1" }, requestMetadata);
    expect(loginOutcome.outcome).toBe("SIGNED_IN");
  });

  it("rejects a duplicate username with 409 USERNAME_TAKEN", async () => {
    await createFixtureUser("taken", "RECORDER");
    await expectApiError(createUserAccount({ username: "taken", password: "Another-Pass-1", role: "RECORDER" }), 409, "USERNAME_TAKEN");
  });

  it("refuses to deactivate the last active TD (SRS-AUTH-08)", async () => {
    const onlyTechnicalUser = await createFixtureUser("td_only", "TECHNICAL");
    const secondTechnicalUser = await createFixtureUser("td_second", "TECHNICAL", false);
    await expectApiError(
      updateInTransaction(secondTechnicalUser.id, onlyTechnicalUser.id, { isActive: false }),
      409,
      "LAST_ACTIVE_TECHNICAL",
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: onlyTechnicalUser.id } })).isActive).toBe(true);
  });

  it("refuses self-deactivation", async () => {
    const technicalUser = await createFixtureUser("td_self", "TECHNICAL");
    await createFixtureUser("td_other", "TECHNICAL");
    await expectApiError(updateInTransaction(technicalUser.id, technicalUser.id, { isActive: false }), 409, "SELF_DEACTIVATION");
  });

  it("deactivation ends every session of the target immediately (SRS-AUTH-07)", async () => {
    const technicalUser = await createFixtureUser("td_actor", "TECHNICAL");
    const recorderUser = await createFixtureUser("recorder_target", "RECORDER");
    await loginWithPassword({ username: "recorder_target", password: FIXTURE_PASSWORD }, requestMetadata);
    await loginWithPassword({ username: "recorder_target", password: FIXTURE_PASSWORD }, requestMetadata);
    expect(await prisma.session.count({ where: { userId: recorderUser.id } })).toBe(2);

    const updatedUser = await updateInTransaction(technicalUser.id, recorderUser.id, { isActive: false });
    expect(updatedUser.isActive).toBe(false);
    expect(await prisma.session.count({ where: { userId: recorderUser.id } })).toBe(0);
  });

  it("reactivation lets the user sign in again", async () => {
    const technicalUser = await createFixtureUser("td_actor", "TECHNICAL");
    const recorderUser = await createFixtureUser("recorder_back", "RECORDER", false);
    await updateInTransaction(technicalUser.id, recorderUser.id, { isActive: true });
    expect((await loginWithPassword({ username: "recorder_back", password: FIXTURE_PASSWORD }, requestMetadata)).outcome).toBe("SIGNED_IN");
  });

  it("password reset replaces the password and ends old sessions", async () => {
    const technicalUser = await createFixtureUser("td_actor", "TECHNICAL");
    const recorderUser = await createFixtureUser("recorder_reset", "RECORDER");
    await loginWithPassword({ username: "recorder_reset", password: FIXTURE_PASSWORD }, requestMetadata);

    await updateInTransaction(technicalUser.id, recorderUser.id, { newPassword: "Brand-New-Pass-1" });
    expect(await prisma.session.count({ where: { userId: recorderUser.id } })).toBe(0);
    expect((await loginWithPassword({ username: "recorder_reset", password: FIXTURE_PASSWORD }, requestMetadata)).outcome).toBe("INVALID_CREDENTIALS");
    expect((await loginWithPassword({ username: "recorder_reset", password: "Brand-New-Pass-1" }, requestMetadata)).outcome).toBe("SIGNED_IN");
  });

  it("returns 404 for an unknown account", async () => {
    const technicalUser = await createFixtureUser("td_actor", "TECHNICAL");
    await expectApiError(updateInTransaction(technicalUser.id, "missing-id", { isActive: true }), 404, "USER_NOT_FOUND");
  });
});
