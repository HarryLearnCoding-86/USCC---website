// src/app/api/tournaments/[tournamentId]/logo/route.ts
// GET — the tournament logo for logged-in arbiters (projection, settings); POST — upload a new logo as
// multipart/form-data field "logo" (TECHNICAL, SRS-TOUR-02). POST honours Idempotency-Key like every mutation.
// SVG is served with a sandboxing CSP so an embedded script could never run even if opened directly (NFR-07).

import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { vi } from "@/i18n/vi";
import { MAXIMUM_LOGO_BYTES } from "@/server/domain/logo-file-rules";
import { ApiError } from "@/server/http/api-error";
import { assertSameOrigin, authorizeApiRequest, convertErrorToResponse, IDEMPOTENCY_KEY_HEADER } from "@/server/http/api-route-handler";
import { runIdempotentOperation } from "@/server/services/idempotency-service";
import { readTournamentLogo, uploadTournamentLogo } from "@/server/services/tournament-logo-service";

export const runtime = "nodejs";

/** Multipart overhead allowed on top of the 2 MB file before the request is rejected unread. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

type LogoRouteContext = { params: Promise<{ tournamentId: string }> };

/**
 * Serves the logo.
 *
 * @returns 200 image bytes; 404 when no logo is set; 401/403 per guards.
 */
export async function GET(request: NextRequest, routeContext: LogoRouteContext): Promise<Response> {
  try {
    await authorizeApiRequest(request, "LOOK_UP_GAMES");
    const { tournamentId } = await routeContext.params;
    const storedLogo = await readTournamentLogo(tournamentId);
    if (!storedLogo) {
      throw new ApiError(404, "LOGO_NOT_FOUND", vi.logo.noLogo);
    }
    return new Response(Buffer.from(storedLogo.fileBytes), {
      headers: {
        "Content-Type": storedLogo.contentType,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (error) {
    return convertErrorToResponse(error);
  }
}

/**
 * Uploads a logo.
 *
 * @returns 200 { storageKey }; 400 LOGO_INVALID_TYPE / missing file; 413 LOGO_TOO_LARGE; 401/403 per guards.
 */
export async function POST(request: NextRequest, routeContext: LogoRouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const signedInUser = await authorizeApiRequest(request, "MANAGE_TOURNAMENTS");
    const { tournamentId } = await routeContext.params;
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAXIMUM_LOGO_BYTES + MULTIPART_OVERHEAD_BYTES) {
      throw new ApiError(413, "LOGO_TOO_LARGE", vi.logo.tooLarge);
    }
    const idempotencyKey = request.headers.get(IDEMPOTENCY_KEY_HEADER)?.trim();
    if (!idempotencyKey) {
      throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", vi.apiErrors.idempotencyKeyRequired);
    }
    const formData = await request.formData();
    const uploadedFile = formData.get("logo");
    if (!(uploadedFile instanceof File)) {
      throw new ApiError(400, "LOGO_MISSING", vi.logo.missingFile);
    }
    const fileBytes = new Uint8Array(await uploadedFile.arrayBuffer());
    // Hash the file bytes (not the multipart text, whose boundary changes on every retry).
    const requestHash = createHash("sha256").update(`POST\n${request.nextUrl.pathname}\n`).update(fileBytes).digest("hex");
    const storedResponse = await runIdempotentOperation({ userId: signedInUser.id, idempotencyKey, requestHash }, async (transaction) => {
      const { storageKey } = await uploadTournamentLogo(tournamentId, fileBytes, transaction);
      return { status: 200, body: { storageKey } };
    });
    return NextResponse.json(storedResponse.body, { status: storedResponse.status });
  } catch (error) {
    return convertErrorToResponse(error);
  }
}
