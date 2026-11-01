// src/app/api/tournaments/[tournamentId]/export/route.ts
// GET /api/tournaments/:id/export?scope=all|round:n&include=official|pending&format=xlsx|xml — results download
// (SRS-EXP-01..05). Official results only by default; include=pending gives the separate reconciliation file.
// format=xml gives the XML file for Swiss-Manager (provisional layout, OI-02). TECHNICAL only.

import type { NextRequest } from "next/server";
import { authorizeApiRequest, convertErrorToResponse } from "@/server/http/api-route-handler";
import { GenericResultWorkbookExporter } from "@/server/export/generic-result-workbook-exporter";
import { ResultXmlExporter } from "@/server/export/result-xml-exporter";
import { buildResultExport } from "@/server/services/result-export-service";
import { exportQuerySchema } from "@/server/validation/import-export-input-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams the export file.
 *
 * @returns 200 xlsx or xml attachment; 400 invalid query; 404 unknown tournament/round; 401/403 per guards.
 */
export async function GET(request: NextRequest, routeContext: { params: Promise<{ tournamentId: string }> }): Promise<Response> {
  try {
    await authorizeApiRequest(request, "EXPORT_RESULTS");
    const { tournamentId } = await routeContext.params;
    const exportQuery = exportQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const resultExporter = exportQuery.format === "xml" ? new ResultXmlExporter() : new GenericResultWorkbookExporter();
    const exportedFile = await buildResultExport({ tournamentId, roundNumber: exportQuery.scope, content: exportQuery.include }, resultExporter);
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
