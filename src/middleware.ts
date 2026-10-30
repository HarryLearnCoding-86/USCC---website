// src/middleware.ts
// Edge middleware: a fast first gate that bounces requests without a session cookie (SRS-AUTH-01).
// Pages redirect to /login; API calls get 401 JSON. It only checks that the cookie exists — the Edge
// runtime cannot reach PostgreSQL — so every page and route still validates the session on the server.

import { NextResponse, type NextRequest } from "next/server";
import { vi } from "@/i18n/vi";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-cookie";

/** Paths reachable without a session. No other public routes exist (CLAUDE.md §2). */
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout"]);

/**
 * Redirects or rejects requests that carry no session cookie.
 *
 * @param request - Incoming request.
 * @returns The pass-through response, a redirect to /login, or a 401 JSON response.
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname) || request.cookies.has(SESSION_COOKIE_NAME)) {
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ code: "UNAUTHENTICATED", messageVi: vi.auth.loginRequired }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Skip Next.js internals and static assets; everything else passes through the gate.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
