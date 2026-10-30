// src/app/api/auth/logout/route.ts
// POST /api/auth/logout — deletes the server-side session and clears the cookie.
// Works even when the session already expired, so the browser always ends up signed out.

import { NextResponse, type NextRequest } from "next/server";
import { buildExpiredSessionCookieAttributes, SESSION_COOKIE_NAME } from "@/server/auth/session-cookie";
import { deleteSessionByToken } from "@/server/auth/session-store";
import { isSessionCookieSecure } from "@/server/config/server-environment";
import { assertSameOrigin, convertErrorToResponse } from "@/server/http/api-route-handler";

/**
 * Signs the current browser out.
 *
 * @param request - Request carrying the session cookie (if any).
 * @returns 200 { signedOut: true } with the cookie cleared; 403 for a cross-origin request.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (sessionToken) {
      await deleteSessionByToken(sessionToken);
    }
    const response = NextResponse.json({ signedOut: true }, { status: 200 });
    response.cookies.set(SESSION_COOKIE_NAME, "", buildExpiredSessionCookieAttributes(isSessionCookieSecure()));
    return response;
  } catch (error) {
    return convertErrorToResponse(error);
  }
}
