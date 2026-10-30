// src/app/api/auth/login/route.ts
// POST /api/auth/login — the only public API endpoint (SRS-AUTH-01).
// Validates credentials and sets the HttpOnly session cookie. Exempt from Idempotency-Key:
// a repeated login simply opens another session, and the offline queue never replays logins.

import { NextResponse, type NextRequest } from "next/server";
import { vi } from "@/i18n/vi";
import { loginInputSchema } from "@/server/auth/account-input-schemas";
import { buildSessionCookieAttributes, SESSION_COOKIE_NAME } from "@/server/auth/session-cookie";
import { isSessionCookieSecure } from "@/server/config/server-environment";
import { ApiError } from "@/server/http/api-error";
import { assertSameOrigin, convertErrorToResponse } from "@/server/http/api-route-handler";
import { loginWithPassword } from "@/server/services/authentication-service";

/**
 * Signs an arbiter in.
 *
 * @param request - JSON body { username, password }.
 * @returns 200 { user: { username, role } } with the session cookie set; 400 invalid body;
 *   401 INVALID_CREDENTIALS; 403 ACCOUNT_INACTIVE or CROSS_ORIGIN_REJECTED.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const loginInput = loginInputSchema.parse(await request.json().catch(() => undefined));
    const loginOutcome = await loginWithPassword(loginInput, {
      userAgent: request.headers.get("user-agent"),
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });

    if (loginOutcome.outcome === "INVALID_CREDENTIALS") {
      throw new ApiError(401, "INVALID_CREDENTIALS", vi.auth.loginError);
    }
    if (loginOutcome.outcome === "ACCOUNT_INACTIVE") {
      throw new ApiError(403, "ACCOUNT_INACTIVE", vi.auth.accountInactiveError);
    }

    const response = NextResponse.json(
      { user: { username: loginOutcome.user.username, role: loginOutcome.user.role } },
      { status: 200 },
    );
    response.cookies.set(
      SESSION_COOKIE_NAME,
      loginOutcome.sessionToken,
      buildSessionCookieAttributes(isSessionCookieSecure()),
    );
    return response;
  } catch (error) {
    return convertErrorToResponse(error);
  }
}
