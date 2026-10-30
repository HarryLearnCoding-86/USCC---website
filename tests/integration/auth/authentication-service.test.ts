// tests/integration/auth/authentication-service.test.ts
// Integration tests for login, session resolution, expiry, deactivation lockout and logout
// against the test database (SRS-AUTH-01, 03, 04, 07).

import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/database/prisma-client";
import { hashSessionToken } from "@/server/auth/session-token";
import { deleteSessionByToken, findSignedInUserBySessionToken } from "@/server/auth/session-store";
import { loginWithPassword } from "@/server/services/authentication-service";
import { createFixtureUser, FIXTURE_PASSWORD, wipeTestDatabase } from "../../helpers/test-database";

const requestMetadata = { userAgent: "vitest", ipAddress: "127.0.0.1" };

describe("loginWithPassword", () => {
  beforeEach(async () => {
    await wipeTestDatabase();
    await createFixtureUser("td_fixture", "TECHNICAL");
  });

  it("signs in with correct credentials and stores only the token hash", async () => {
    const loginOutcome = await loginWithPassword({ username: "td_fixture", password: FIXTURE_PASSWORD }, requestMetadata);
    expect(loginOutcome.outcome).toBe("SIGNED_IN");
    if (loginOutcome.outcome !== "SIGNED_IN") return;

    const storedSessions = await prisma.session.findMany();
    expect(storedSessions).toHaveLength(1);
    expect(storedSessions[0]?.tokenHash).toBe(hashSessionToken(loginOutcome.sessionToken));
    expect(storedSessions[0]?.tokenHash).not.toBe(loginOutcome.sessionToken);
  });

  it("returns INVALID_CREDENTIALS for a wrong password or an unknown username", async () => {
    expect((await loginWithPassword({ username: "td_fixture", password: "wrong" }, requestMetadata)).outcome).toBe(
      "INVALID_CREDENTIALS",
    );
    expect((await loginWithPassword({ username: "nobody", password: FIXTURE_PASSWORD }, requestMetadata)).outcome).toBe(
      "INVALID_CREDENTIALS",
    );
    expect(await prisma.session.count()).toBe(0);
  });

  it("refuses an inactive account only after a correct password", async () => {
    await createFixtureUser("inactive_fixture", "RECORDER", false);
    expect((await loginWithPassword({ username: "inactive_fixture", password: "wrong" }, requestMetadata)).outcome).toBe(
      "INVALID_CREDENTIALS",
    );
    expect(
      (await loginWithPassword({ username: "inactive_fixture", password: FIXTURE_PASSWORD }, requestMetadata)).outcome,
    ).toBe("ACCOUNT_INACTIVE");
  });
});

describe("session resolution", () => {
  let sessionToken: string;

  beforeEach(async () => {
    await wipeTestDatabase();
    await createFixtureUser("recorder_fixture", "RECORDER");
    const loginOutcome = await loginWithPassword(
      { username: "recorder_fixture", password: FIXTURE_PASSWORD },
      requestMetadata,
    );
    if (loginOutcome.outcome !== "SIGNED_IN") throw new Error("fixture login failed");
    sessionToken = loginOutcome.sessionToken;
  });

  it("resolves a valid token to its user", async () => {
    expect(await findSignedInUserBySessionToken(sessionToken)).toMatchObject({
      username: "recorder_fixture",
      role: "RECORDER",
    });
  });

  it("rejects unknown tokens", async () => {
    expect(await findSignedInUserBySessionToken("not-a-real-token")).toBeNull();
  });

  it("rejects and deletes a session idle for longer than the timeout (SRS-AUTH-04)", async () => {
    const seventeenHoursLater = new Date(Date.now() + 17 * 60 * 60 * 1000);
    expect(await findSignedInUserBySessionToken(sessionToken, seventeenHoursLater)).toBeNull();
    expect(await prisma.session.count()).toBe(0);
  });

  it("slides the expiry forward on activity", async () => {
    const tenMinutesLater = new Date(Date.now() + 10 * 60 * 1000);
    const expiryBefore = (await prisma.session.findFirstOrThrow()).expiresAt;
    await findSignedInUserBySessionToken(sessionToken, tenMinutesLater);
    const expiryAfter = (await prisma.session.findFirstOrThrow()).expiresAt;
    expect(expiryAfter.getTime()).toBeGreaterThan(expiryBefore.getTime());
  });

  it("locks out a deactivated user on the next request, even if the session row survived (SRS-AUTH-07)", async () => {
    await prisma.user.update({ where: { username: "recorder_fixture" }, data: { isActive: false } });
    expect(await findSignedInUserBySessionToken(sessionToken)).toBeNull();
  });

  it("logout deletes the session", async () => {
    await deleteSessionByToken(sessionToken);
    expect(await findSignedInUserBySessionToken(sessionToken)).toBeNull();
  });
});
