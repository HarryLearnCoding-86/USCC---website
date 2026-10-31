// src/app/api/tournaments/[tournamentId]/export/route.ts
// GET /api/tournaments/:id/export?scope=all|round:n&include=official|pending — .xlsx download (SRS-EXP-01..05).
// Official results only by default; include=pending gives the separate reconciliation file. TECHNICAL only.

import type { NextRequest } from "next/server";
import { authorizeApiRequest, convertErrorToResponse } from "@/server/http/api-route-handler";
import { buildResultExport } from "@/server/services/result-export-service";
import { exportQuerySchema } from "@/server/validation/import-export-input-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams the export workbook.
 *
 * @returns 200 xlsx attachment; 400 invalid query; 404 unknown tournament/round; 401/403 per guards.
 */
export async function GET(request: NextRequest, routeContext: { params: Promise<{ tournamentId: string }> }): Promise<Response> {
  try {
    await authorizeApiRequest(request, "EXPORT_RESULTS");
    const { tournamentId } = await routeContext.params;
    const exportQuery = exportQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const exportedFile = await buildResultExport({ tournamentId, roundNumber: exportQuery.scope, content: exportQuery.include });
    return new Response(Buffer.from(exportedFile.fileBytes), {
      headers: {
        "Content-Type": exportedFile.contentType,
        "Content-Disposition": `attachment; filename="${exportedFile.fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return convertErrorToResponse(error);
  }
}
