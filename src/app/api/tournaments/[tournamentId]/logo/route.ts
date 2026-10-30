// src/app/api/tournaments/[tournamentId]/logo/route.ts
// GET — the tournament logo for logged-in arbiters (projection, settings); POST — upload a new logo as
// multipart/form-data field "logo" (TECHNICAL, SRS-TOUR-02). POST honours Idempotency-Key like every mutation.
// SVG is served with a sandboxing CSP so an embedded script could never run even if opened directly (NFR-07).

import type { NextRequest } from "next/server";
import { vi } from "@/i18n/vi";
import { MAXIMUM_LOGO_BYTES } from "@/server/domain/logo-file-rules";
import { ApiError } from "@/server/http/api-error";
import { authorizeApiRequest, convertErrorToResponse } from "@/server/http/api-route-handler";
import { handleFileUpload } from "@/server/http/file-upload-route";
import { readTournamentLogo, uploadTournamentLogo } from "@/server/services/tournament-logo-service";

export const runtime = "nodejs";

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
 * @returns 200 { storageKey }; 400 LOGO_INVALID_TYPE / LOGO_MISSING; 413 LOGO_TOO_LARGE; 401/403 per guards.
 */
export async function POST(request: NextRequest, routeContext: LogoRouteContext): Promise<Response> {
  const { tournamentId } = await routeContext.params;
  return handleFileUpload(
    request,
    {
      requiredPermission: "MANAGE_TOURNAMENTS",
      fileFieldName: "logo",
      maximumFileBytes: MAXIMUM_LOGO_BYTES,
      tooLargeError: new ApiError(413, "LOGO_TOO_LARGE", vi.logo.tooLarge),
      missingFileError: new ApiError(400, "LOGO_MISSING", vi.logo.missingFile),
    },
    async ({ fileBytes, database }) => {
      const { storageKey } = await uploadTournamentLogo(tournamentId, fileBytes, database);
      return { status: 200, body: { storageKey } };
    },
  );
}
