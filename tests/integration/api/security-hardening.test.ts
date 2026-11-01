// tests/integration/api/security-hardening.test.ts
// Phase 5 hardening through the real route handlers (SRS-AUTH-05, SRS §10.2, NFR-07):
//   - mutations without a valid CSRF token are refused and change nothing; logout of a live session needs it too;
//   - 5 failed logins in 10 minutes lock the username (429 + Retry-After), even for the right password, without
//     extending the lock, while other usernames are unaffected; login sets the readable CSRF cookie;
//   - the maintenance job deletes expired sessions, old idempotency records and old login attempts only.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/database/prisma-client";
import { CSRF_COOKIE_NAME } from "@/server/auth/csrf-token";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-cookie";
import { loginWithPassword } from "@/server/services/authentication-service";
import { runMaintenance } from "@/server/services/maintenance-service";
import { POST as createUser } from "@/app/api/users/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { computeCsrfTokenForTest } from "../../helpers/csrf-test-token";
import { createFixtureUser, FIXTURE_PASSWORD, wipeTestDatabase } from "../../helpers/test-database";

const APP_ORIGIN = "http://localhost:3000";

/**
 * Builds a JSON POST.
 *
 * @param path - Path.
 * @param options - Session token, CSRF token (null omits), body and idempotency key.
 * @returns The request.
 */
function buildPost(path: string, options: { sessionToken?: string; csrfToken?: string | null; body?: unknown; idempotencyKey?: string }): NextRequest {
  const headers = new Headers({ "content-type": "application/json", origin: APP_ORIGIN });
  if (options.sessionToken) headers.set("cookie", `${SESSION_COOKIE_NAME}=${options.sessionToken}`);
  if (options.csrfToken) headers.set("x-csrf-token", options.csrfToken);
  if (options.idempotencyKey) headers.set("idempotency-key", options.idempotencyKey);
  return new NextRequest(`${APP_ORIGIN}${path}`, { method: "POST", headers, body: JSON.stringify(options.body ?? {}) });
}

/**
 * Signs a fixture user in.
 *
 * @param username - Fixture username.
 * @returns Raw session token.
 */
async function signIn(username: string): Promise<string> {
  const loginOutcome = await loginWithPassword({ username, password: FIXTURE_PASSWORD }, { userAgent: null, ipAddress: null });
  if (loginOutcome.outcome !== "SIGNED_IN") throw new Error("fixture login failed");
  return loginOutcome.sessionToken;
}

describe("CSRF protection (SRS §10.2)", () => {
  let technicalSessionToken: string;
  const newUserBody = { username: "csrf_target", password: "Csrf-Password-1", role: "RECORDER" };

  beforeEach(async () => {
    await wipeTestDatabase();
    await createFixtureUser("td_csrf", "TECHNICAL");
    technicalSessionToken = await signIn("td_csrf");
  });

  it.each([
    ["missing", null],
    ["wrong", "not-the-right-token"],
    ["from another session", computeCsrfTokenForTest("someone-elses-session")],
  ])("refuses a mutation with a %s token and changes nothing", async (_caseName, csrfToken) => {
    const response = await createUser(
      buildPost("/api/users", { sessionToken: technicalSessionToken, csrfToken, body: newUserBody, idempotencyKey: `k-${String(csrfToken)}` }),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "CSRF_TOKEN_INVALID" });
    expect(await prisma.user.count({ where: { username: "csrf_target" } })).toBe(0);
  });

  it("accepts the session's token", async () => {
    const response = await createUser(
      buildPost("/api/users", { sessionToken: technicalSessionToken, csrfToken: computeCsrfTokenForTest(technicalSessionToken), body: newUserBody, idempotencyKey: "k-ok" }),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(201);
  });

  it("requires the token to log out a live session, and clears both cookies", async () => {
    expect((await logout(buildPost("/api/auth/logout", { sessionToken: technicalSessionToken }))).status).toBe(403);
    expect(await prisma.session.count()).toBe(1);
    const response = await logout(buildPost("/api/auth/logout", { sessionToken: technicalSessionToken, csrfToken: computeCsrfTokenForTest(technicalSessionToken) }));
    expect(response.status).toBe(200);
    expect(await prisma.session.count()).toBe(0);
    const setCookieHeader = response.headers.get("set-cookie") ?? "";
    expect(setCookieHeader).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(setCookieHeader).toContain(`${CSRF_COOKIE_NAME}=;`);
  });
});

describe("login lockout (SRS-AUTH-05)", () => {
  beforeEach(async () => {
    await wipeTestDatabase();
    await createFixtureUser("td_locked", "TECHNICAL");
    await createFixtureUser("td_other", "TECHNICAL");
  });

  const attemptLogin = (username: string, password: string) => login(buildPost("/api/auth/login", { body: { username, password } }));

  it("locks a username after 5 failures, even for the right password, and only that username", async () => {
    for (let attemptIndex = 0; attemptIndex < 5; attemptIndex++) {
      expect((await attemptLogin("td_locked", "wrong-password")).status).toBe(401);
    }
    const lockedResponse = await attemptLogin("td_locked", FIXTURE_PASSWORD);
    expect(lockedResponse.status).toBe(429);
    expect(await lockedResponse.json()).toMatchObject({ code: "LOGIN_LOCKED" });
    expect(Number(lockedResponse.headers.get("retry-after"))).toBeGreaterThan(500);
    // Attempts during the lock are not recorded, so they cannot extend it.
    expect(await prisma.loginAttempt.count({ where: { usernameAttempted: "td_locked" } })).toBe(5);
    expect((await attemptLogin("td_other", FIXTURE_PASSWORD)).status).toBe(200);
  });

  it("throttles unknown usernames the same way", async () => {
    for (let attemptIndex = 0; attemptIndex < 5; attemptIndex++) await attemptLogin("no_such_user", "x");
    expect((await attemptLogin("no_such_user", "x")).status).toBe(429);
  });

  it("unlocks after 10 minutes", async () => {
    const lockStart = new Date();
    for (let attemptIndex = 0; attemptIndex < 5; attemptIndex++) {
      await loginWithPassword({ username: "td_locked", password: "wrong" }, { userAgent: null, ipAddress: null }, lockStart);
    }
    expect((await loginWithPassword({ username: "td_locked", password: FIXTURE_PASSWORD }, { userAgent: null, ipAddress: null }, lockStart)).outcome).toBe("LOCKED");
    const elevenMinutesLater = new Date(lockStart.getTime() + 11 * 60 * 1000);
    expect((await loginWithPassword({ username: "td_locked", password: FIXTURE_PASSWORD }, { userAgent: null, ipAddress: null }, elevenMinutesLater)).outcome).toBe("SIGNED_IN");
  });

  it("sets the readable CSRF cookie at login", async () => {
    const response = await attemptLogin("td_locked", FIXTURE_PASSWORD);
    const setCookieHeader = response.headers.get("set-cookie") ?? "";
    expect(setCookieHeader).toMatch(new RegExp(`${CSRF_COOKIE_NAME}=[A-Za-z0-9_-]{43}`));
    expect(setCookieHeader.toLowerCase()).toContain("samesite=strict");
  });
});

describe("runMaintenance", () => {
  beforeEach(async () => {
    await wipeTestDatabase();
  });

  it("deletes only expired sessions, old idempotency records and old login attempts", async () => {
    const user = await createFixtureUser("td_maintenance", "TECHNICAL");
    const now = new Date();
    const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);
    await prisma.session.createMany({
      data: [
        { userId: user.id, tokenHash: "expired", expiresAt: hoursAgo(1) },
        { userId: user.id, tokenHash: "active", expiresAt: new Date(now.getTime() + 3600_000) },
      ],
    });
    await prisma.idempotencyRecord.createMany({
      data: [
        { userId: user.id, idempotencyKey: "old", requestHash: "h", responseStatus: 200, responseBody: {}, createdAt: hoursAgo(49) },
        { userId: user.id, idempotencyKey: "recent", requestHash: "h", responseStatus: 200, responseBody: {}, createdAt: hoursAgo(47) },
      ],
    });
    await prisma.loginAttempt.createMany({
      data: [
        { usernameAttempted: "x", wasSuccessful: false, attemptedAt: hoursAgo(25) },
        { usernameAttempted: "x", wasSuccessful: false, attemptedAt: hoursAgo(1) },
      ],
    });
    expect(await runMaintenance(now)).toEqual({ expiredSessionCount: 1, expiredIdempotencyRecordCount: 1, oldLoginAttemptCount: 1 });
    expect(await prisma.session.findMany({ select: { tokenHash: true } })).toEqual([{ tokenHash: "active" }]);
    expect(await prisma.idempotencyRecord.count()).toBe(1);
    expect(await prisma.loginAttempt.count()).toBe(1);
  });
});
