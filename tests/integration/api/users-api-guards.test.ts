// tests/integration/api/users-api-guards.test.ts
// Integration tests that call the real route handlers with NextRequest objects to prove the server enforces
// authentication (401), role (403), same-origin and Idempotency-Key rules on /api/users (SRS-AUTH-01, 06; SRS-SYNC-03).

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/database/prisma-client";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-cookie";
import { loginWithPassword } from "@/server/services/authentication-service";
import { GET as listUsers, POST as createUser } from "@/app/api/users/route";
import { POST as login } from "@/app/api/auth/login/route";
import { createFixtureUser, FIXTURE_PASSWORD, wipeTestDatabase } from "../../helpers/test-database";

const APP_ORIGIN = "http://localhost:3000";
const emptyRouteContext = { params: Promise.resolve({}) };

/**
 * Builds a request to the users API.
 *
 * @param options - Method, optional session token, body, origin and idempotency key.
 * @returns A NextRequest.
 */
function buildUsersRequest(options: {
  method: "GET" | "POST";
  sessionToken?: string;
  body?: unknown;
  origin?: string;
  idempotencyKey?: string;
}): NextRequest {
  const headers = new Headers({ "content-type": "application/json", origin: options.origin ?? APP_ORIGIN });
  if (options.sessionToken) headers.set("cookie", `${SESSION_COOKIE_NAME}=${options.sessionToken}`);
  if (options.idempotencyKey) headers.set("idempotency-key", options.idempotencyKey);
  return new NextRequest(`${APP_ORIGIN}/api/users`, {
    method: options.method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

/**
 * Signs a fixture user in and returns the raw session token.
 *
 * @param username - Fixture username.
 * @returns The session token.
 */
async function signIn(username: string): Promise<string> {
  const loginOutcome = await loginWithPassword({ username, password: FIXTURE_PASSWORD }, { userAgent: null, ipAddress: null });
  if (loginOutcome.outcome !== "SIGNED_IN") throw new Error(`fixture login failed for ${username}`);
  return loginOutcome.sessionToken;
}

describe("/api/users guards", () => {
  let technicalSessionToken: string;
  let recorderSessionToken: string;
  const newUserBody = { username: "created_by_api", password: "Api-Password-1", role: "RECORDER" };

  beforeEach(async () => {
    await wipeTestDatabase();
    await createFixtureUser("td_api", "TECHNICAL");
    await createFixtureUser("recorder_api", "RECORDER");
    technicalSessionToken = await signIn("td_api");
    recorderSessionToken = await signIn("recorder_api");
  });

  it("returns 401 without a session (SRS-AUTH-01)", async () => {
    const response = await listUsers(buildUsersRequest({ method: "GET" }), emptyRouteContext);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("returns 403 to a RECORDER, checked on the server (SRS-AUTH-06)", async () => {
    const response = await listUsers(buildUsersRequest({ method: "GET", sessionToken: recorderSessionToken }), emptyRouteContext);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("lists users for a TECHNICAL user without exposing password hashes", async () => {
    const response = await listUsers(buildUsersRequest({ method: "GET", sessionToken: technicalSessionToken }), emptyRouteContext);
    expect(response.status).toBe(200);
    const responseText = await response.text();
    expect(responseText).toContain("recorder_api");
    expect(responseText).not.toContain("argon2");
  });

  it("rejects a cross-origin mutation with 403 (NFR-07)", async () => {
    const response = await createUser(
      buildUsersRequest({ method: "POST", sessionToken: technicalSessionToken, body: newUserBody, origin: "https://evil.example", idempotencyKey: "k-1" }),
      emptyRouteContext,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "CROSS_ORIGIN_REJECTED" });
  });

  it("requires an Idempotency-Key on mutations", async () => {
    const response = await createUser(
      buildUsersRequest({ method: "POST", sessionToken: technicalSessionToken, body: newUserBody }),
      emptyRouteContext,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });
  });

  it("creates a user once and replays the same 201 for a repeated key (SRS-SYNC-03)", async () => {
    const request = () =>
      buildUsersRequest({ method: "POST", sessionToken: technicalSessionToken, body: newUserBody, idempotencyKey: "create-once" });
    const firstResponse = await createUser(request(), emptyRouteContext);
    const repeatedResponse = await createUser(request(), emptyRouteContext);
    expect(firstResponse.status).toBe(201);
    expect(repeatedResponse.status).toBe(201);
    expect(await repeatedResponse.json()).toEqual(await firstResponse.json());
    expect(await prisma.user.count({ where: { username: "created_by_api" } })).toBe(1);
  });

  it("returns 400 with field details for an invalid body", async () => {
    const response = await createUser(
      buildUsersRequest({ method: "POST", sessionToken: technicalSessionToken, body: { ...newUserBody, password: "short" }, idempotencyKey: "k-2" }),
      emptyRouteContext,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_INPUT", details: [{ path: "password" }] });
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    await wipeTestDatabase();
    await createFixtureUser("td_login", "TECHNICAL");
  });

  /**
   * Builds a login request.
   *
   * @param body - JSON body.
   * @returns A NextRequest.
   */
  function buildLoginRequest(body: unknown): NextRequest {
    return new NextRequest(`${APP_ORIGIN}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP_ORIGIN },
      body: JSON.stringify(body),
    });
  }

  it("sets an HttpOnly, SameSite=Lax session cookie on success (SRS-AUTH-04)", async () => {
    const response = await login(buildLoginRequest({ username: "TD_LOGIN", password: FIXTURE_PASSWORD }));
    expect(response.status).toBe(200);
    const setCookieHeader = response.headers.get("set-cookie") ?? "";
    expect(setCookieHeader).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookieHeader.toLowerCase()).toContain("httponly");
    expect(setCookieHeader.toLowerCase()).toContain("samesite=lax");
  });

  it("returns the generic 401 message for wrong credentials", async () => {
    const response = await login(buildLoginRequest({ username: "td_login", password: "wrong-password" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
