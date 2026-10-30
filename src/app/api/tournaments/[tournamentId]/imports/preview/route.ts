// src/app/api/tournaments/[tournamentId]/imports/preview/route.ts
// POST /api/tournaments/:id/imports/preview — read the uploaded workbook through the TD's mapping, validate every
// row, resolve players and diff the round (SRS-IMP-03..09). Writes no pairing data. TECHNICAL only.

import { createApiRouteHandler } from "@/server/http/api-route-handler";
import { toJsonBody } from "@/server/http/json-body";
import { buildImportPreview, toPublicImportPreview } from "@/server/services/pairing-import-service";
import { importPreviewInputSchema } from "@/server/validation/import-export-input-schemas";

/**
 * Builds the preview. It reads with the plain client so the idempotency transaction stays short.
 *
 * @returns 200 { preview }; 400 IMPORT_MAPPING_INVALID / unreadable sheet; 404 ROUND_NOT_FOUND / IMPORT_UPLOAD_NOT_FOUND.
 */
export const POST = createApiRouteHandler<{ tournamentId: string }>("IMPORT_PAIRINGS", async ({ requestBody, routeParams }) => {
  const importPreview = await buildImportPreview(routeParams.tournamentId, importPreviewInputSchema.parse(requestBody));
  return { status: 200, body: { preview: toJsonBody(toPublicImportPreview(importPreview)) } };
});
