// src/middleware.ts
// Edge middleware: a fast first gate that bounces requests without a session cookie (SRS-AUTH-01).
// Pages redirect to /login; API calls get 401 JSON. It only checks that the cookie exists — the Edge
// runtime cannot reach PostgreSQL — so every page and route still validates the session on the server.
// It also stamps each request with an X-Request-Id for structured logs (NFR-14), and re-issues the readable CSRF
// cookie when a session exists without one (e.g. a session opened before CSRF tokens were introduced).

import { NextResponse, type NextRequest } from "next/server";
import { vi } from "@/i18n/vi";
import { buildCsrfCookieAttributes, CSRF_COOKIE_NAME, deriveCsrfToken } from "@/server/auth/csrf-token";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-cookie";
import { REQUEST_ID_HEADER } from "@/server/observability/server-logger";

/** Paths reachable without a session. No other public routes exist (CLAUDE.md §2). */
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout"]);

/**
 * Redirects or rejects requests that carry no session cookie, and adds the request ID.
 *
 * @param request - Incoming request.
 * @returns The pass-through response, a redirect to /login, or a 401 JSON response.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!PUBLIC_PATHS.has(pathname) && !sessionToken) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ code: "UNAUTHENTICATED", messageVi: vi.auth.loginRequired }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set(REQUEST_ID_HEADER, request.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID());
  const response = NextResponse.next({ request: { headers: forwardedHeaders } });
  if (sessionToken && !request.cookies.has(CSRF_COOKIE_NAME)) {
    // Same rule as isSessionCookieSecure(); the Edge runtime reads NODE_ENV directly.
    const isSecure = process.env.SESSION_COOKIE_SECURE ? process.env.SESSION_COOKIE_SECURE === "true" : process.env.NODE_ENV === "production";
    response.cookies.set(CSRF_COOKIE_NAME, await deriveCsrfToken(sessionToken), buildCsrfCookieAttributes(isSecure));
  }
  return response;
}

export const config = {
  // Skip Next.js internals and static assets; everything else passes through the gate.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
