// src/server/http/api-route-handler.ts
// Wraps every authenticated API route handler with the cross-cutting rules, in this order:
// same-origin check on mutations → session (401) → role permission (403, SRS-AUTH-06) →
// JSON body parsing → Idempotency-Key handling on mutations (SRS-SYNC-03) → error mapping to { code, messageVi }.
// Route files stay thin: they declare a permission and call a service.

import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { vi } from "@/i18n/vi";
import { getServerEnvironment } from "@/server/config/server-environment";
import type { DatabaseClient } from "@/server/database/database-client";
import { prisma } from "@/server/database/prisma-client";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-cookie";
import { findSignedInUserBySessionToken, type SignedInUser } from "@/server/auth/session-store";
import { hasPermission, type Permission } from "@/server/auth/role-permissions";
import { isSameOriginRequest } from "@/server/auth/same-origin-check";
import { ApiError, toApiErrorBody } from "@/server/http/api-error";
import { computeRequestHash, runIdempotentOperation } from "@/server/services/idempotency-service";

/** HTTP header carrying the client-generated idempotency key. */
export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

/** Longest accepted idempotency key; UUIDs are 36 characters. */
const MAXIMUM_IDEMPOTENCY_KEY_LENGTH = 100;

/** Everything a route's business callback receives. */
export interface ApiHandlerContext<TRouteParams> {
  request: NextRequest;
  signedInUser: SignedInUser;
  routeParams: TRouteParams;
  /** Parsed JSON body (undefined for GET or an empty body); validate it with Zod in the route. */
  requestBody: unknown;
  /** Transaction client for mutations (shared with the idempotency record), the plain client for GET. */
  database: DatabaseClient;
}

/** A successful response from a route callback. */
export interface ApiHandlerResult {
  status: number;
  body: Prisma.InputJsonValue;
}

/** Next.js route-handler second argument; params is a Promise since Next.js 15. */
interface NextRouteContext<TRouteParams> {
  params: Promise<TRouteParams>;
}

/**
 * Creates a Next.js route handler with authentication, authorization, idempotency and error mapping.
 *
 * @param requiredPermission - Permission from the SRS §4.1 matrix that the caller must hold.
 * @param handleRequest - Business callback; throw ApiError or ZodError for expected failures.
 * @returns A function suitable as an exported GET/POST/PATCH/DELETE handler.
 */
export function createApiRouteHandler<TRouteParams = Record<string, never>>(
  requiredPermission: Permission,
  handleRequest: (context: ApiHandlerContext<TRouteParams>) => Promise<ApiHandlerResult>,
) {
  return async function handleApiRoute(
    request: NextRequest,
    routeContext: NextRouteContext<TRouteParams>,
  ): Promise<NextResponse> {
    try {
      assertSameOrigin(request);
      const signedInUser = await authenticateApiRequest(request);
      if (!hasPermission(signedInUser.role, requiredPermission)) {
        throw new ApiError(403, "FORBIDDEN", vi.auth.forbidden);
      }
      const routeParams = await routeContext.params;
      const requestBodyText = await request.text();
      const requestBody = parseJsonBody(requestBodyText);
      const baseContext = { request, signedInUser, routeParams, requestBody };

      if (isReadOnlyMethod(request.method)) {
        const result = await handleRequest({ ...baseContext, database: prisma });
        return NextResponse.json(result.body, { status: result.status });
      }

      const idempotencyKey = readIdempotencyKey(request);
      const result = await runIdempotentOperation(
        {
          userId: signedInUser.id,
          idempotencyKey,
          requestHash: computeRequestHash(request.method, request.nextUrl.pathname, requestBodyText),
        },
        (transaction) => handleRequest({ ...baseContext, database: transaction }),
      );
      return NextResponse.json(result.body, { status: result.status });
    } catch (error) {
      return convertErrorToResponse(error);
    }
  };
}

/**
 * Rejects cross-site mutating requests (NFR-07 CSRF defence, see same-origin-check.ts).
 *
 * @param request - Incoming request.
 * @throws ApiError 403 CROSS_ORIGIN_REJECTED.
 */
export function assertSameOrigin(request: NextRequest): void {
  const allowedOrigins = [getServerEnvironment().APP_URL, request.nextUrl.origin];
  if (!isSameOriginRequest(request.method, request.headers.get("origin"), allowedOrigins)) {
    throw new ApiError(403, "CROSS_ORIGIN_REJECTED", vi.auth.crossOriginRejected);
  }
}

/**
 * Authenticates a request and checks one permission, for handlers that cannot use createApiRouteHandler
 * (streaming SSE responses, binary downloads).
 *
 * @param request - Incoming request.
 * @param requiredPermission - Permission from the SRS §4.1 matrix.
 * @returns The signed-in user.
 * @throws ApiError 401 UNAUTHENTICATED or 403 FORBIDDEN.
 */
export async function authorizeApiRequest(request: NextRequest, requiredPermission: Permission): Promise<SignedInUser> {
  const signedInUser = await authenticateApiRequest(request);
  if (!hasPermission(signedInUser.role, requiredPermission)) {
    throw new ApiError(403, "FORBIDDEN", vi.auth.forbidden);
  }
  return signedInUser;
}

/**
 * Resolves the session cookie to a user.
 *
 * @param request - Incoming request.
 * @returns The signed-in user.
 * @throws ApiError 401 UNAUTHENTICATED when there is no valid session (SRS-AUTH-01).
 */
async function authenticateApiRequest(request: NextRequest): Promise<SignedInUser> {
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const signedInUser = sessionToken ? await findSignedInUserBySessionToken(sessionToken) : null;
  if (!signedInUser) {
    throw new ApiError(401, "UNAUTHENTICATED", vi.auth.loginRequired);
  }
  return signedInUser;
}

/**
 * Reads and validates the Idempotency-Key header, which every mutation must carry.
 *
 * @param request - Incoming request.
 * @returns The key.
 * @throws ApiError 400 IDEMPOTENCY_KEY_REQUIRED when missing or malformed.
 */
function readIdempotencyKey(request: NextRequest): string {
  const idempotencyKey = request.headers.get(IDEMPOTENCY_KEY_HEADER)?.trim();
  if (!idempotencyKey || idempotencyKey.length > MAXIMUM_IDEMPOTENCY_KEY_LENGTH) {
    throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", vi.apiErrors.idempotencyKeyRequired);
  }
  return idempotencyKey;
}

/**
 * Parses a JSON request body.
 *
 * @param requestBodyText - Raw body text.
 * @returns The parsed value, or undefined for an empty body.
 * @throws ApiError 400 INVALID_INPUT for malformed JSON.
 */
function parseJsonBody(requestBodyText: string): unknown {
  if (requestBodyText.trim() === "") {
    return undefined;
  }
  try {
    return JSON.parse(requestBodyText) as unknown;
  } catch {
    throw new ApiError(400, "INVALID_INPUT", vi.apiErrors.invalidInput);
  }
}

/**
 * Whether a method is read-only (no idempotency key, no transaction).
 *
 * @param httpMethod - Request method.
 * @returns true for GET and HEAD.
 */
function isReadOnlyMethod(httpMethod: string): boolean {
  return httpMethod === "GET" || httpMethod === "HEAD";
}

/**
 * Maps any thrown value to a JSON error response. Unexpected errors are logged and hidden
 * behind a generic 500 so stack traces never reach the browser.
 *
 * @param error - Anything thrown by guards, parsing or the route callback.
 * @returns The error response.
 */
export function convertErrorToResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(toApiErrorBody(error), { status: error.httpStatus });
  }
  if (error instanceof ZodError) {
    const fieldErrors = error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
    const validationError = new ApiError(400, "INVALID_INPUT", vi.apiErrors.invalidInput, fieldErrors);
    return NextResponse.json(toApiErrorBody(validationError), { status: 400 });
  }
  console.error("Unhandled API error", error);
  return NextResponse.json({ code: "SERVER_ERROR", messageVi: vi.apiErrors.serverError }, { status: 500 });
}
