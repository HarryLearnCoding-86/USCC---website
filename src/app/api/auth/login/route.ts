// src/app/api/auth/login/route.ts
// POST /api/auth/login — the only public API endpoint (SRS-AUTH-01).
// Validates credentials, enforces the per-username lockout (SRS-AUTH-05), and sets the HttpOnly session cookie plus
// the readable CSRF cookie. Exempt from Idempotency-Key and the CSRF header: there is no session yet, a repeated
// login simply opens another session, and the same-origin check still applies.

import { NextResponse, type NextRequest } from "next/server";
import { vi } from "@/i18n/vi";
import { loginInputSchema } from "@/server/auth/account-input-schemas";
import { buildCsrfCookieAttributes, CSRF_COOKIE_NAME, deriveCsrfToken } from "@/server/auth/csrf-token";
import { buildSessionCookieAttributes, SESSION_COOKIE_NAME } from "@/server/auth/session-cookie";
import { isSessionCookieSecure } from "@/server/config/server-environment";
import { ApiError } from "@/server/http/api-error";
import { assertSameOrigin, convertErrorToResponse } from "@/server/http/api-route-handler";
import { loginWithPassword } from "@/server/services/authentication-service";

/**
 * Signs an arbiter in.
 *
 * @param request - JSON body { username, password }.
 * @returns 200 { user: { username, role } } with the session and CSRF cookies set; 400 invalid body;
 *   401 INVALID_CREDENTIALS; 403 ACCOUNT_INACTIVE or CROSS_ORIGIN_REJECTED; 429 LOGIN_LOCKED with Retry-After.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const loginInput = loginInputSchema.parse(await request.json().catch(() => undefined));
    const loginOutcome = await loginWithPassword(loginInput, {
      userAgent: request.headers.get("user-agent"),
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });

    if (loginOutcome.outcome === "LOCKED") {
      const response = convertErrorToResponse(
        new ApiError(429, "LOGIN_LOCKED", vi.auth.loginLocked(Math.ceil(loginOutcome.retryAfterSeconds / 60))),
        request,
      );
      response.headers.set("Retry-After", String(loginOutcome.retryAfterSeconds));
      return response;
    }
    if (loginOutcome.outcome === "INVALID_CREDENTIALS") {
      throw new ApiError(401, "INVALID_CREDENTIALS", vi.auth.loginError);
    }
    if (loginOutcome.outcome === "ACCOUNT_INACTIVE") {
      throw new ApiError(403, "ACCOUNT_INACTIVE", vi.auth.accountInactiveError);
    }

    const isSecure = isSessionCookieSecure();
    const response = NextResponse.json(
      { user: { username: loginOutcome.user.username, role: loginOutcome.user.role } },
      { status: 200 },
    );
    response.cookies.set(SESSION_COOKIE_NAME, loginOutcome.sessionToken, buildSessionCookieAttributes(isSecure));
    response.cookies.set(CSRF_COOKIE_NAME, await deriveCsrfToken(loginOutcome.sessionToken), buildCsrfCookieAttributes(isSecure));
    return response;
  } catch (error) {
    return convertErrorToResponse(error, request);
  }
}
