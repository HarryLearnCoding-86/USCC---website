// src/app/api/auth/logout/route.ts
// POST /api/auth/logout — deletes the server-side session and clears the session and CSRF cookies.
// Works even when the session already expired, so the browser always ends up signed out. A live session can only
// be ended with its CSRF token, so another site cannot sign an arbiter out mid-round.

import { NextResponse, type NextRequest } from "next/server";
import { buildCsrfCookieAttributes, CSRF_COOKIE_NAME } from "@/server/auth/csrf-token";
import { buildExpiredSessionCookieAttributes, SESSION_COOKIE_NAME } from "@/server/auth/session-cookie";
import { deleteSessionByToken, findSignedInUserBySessionToken } from "@/server/auth/session-store";
import { isSessionCookieSecure } from "@/server/config/server-environment";
import { assertCsrfToken, assertSameOrigin, convertErrorToResponse } from "@/server/http/api-route-handler";

/**
 * Signs the current browser out.
 *
 * @param request - Request carrying the session cookie (if any) and the X-CSRF-Token header.
 * @returns 200 { signedOut: true } with both cookies cleared; 403 for a cross-origin request or a bad CSRF token.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (sessionToken && (await findSignedInUserBySessionToken(sessionToken))) {
      await assertCsrfToken(request);
      await deleteSessionByToken(sessionToken);
    }
    const isSecure = isSessionCookieSecure();
    const response = NextResponse.json({ signedOut: true }, { status: 200 });
    response.cookies.set(SESSION_COOKIE_NAME, "", buildExpiredSessionCookieAttributes(isSecure));
    response.cookies.set(CSRF_COOKIE_NAME, "", buildCsrfCookieAttributes(isSecure, true));
    return response;
  } catch (error) {
    return convertErrorToResponse(error, request);
  }
}
