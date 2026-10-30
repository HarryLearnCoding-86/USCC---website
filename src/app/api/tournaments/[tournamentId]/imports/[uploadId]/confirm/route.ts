// src/app/api/tournaments/[tournamentId]/imports/[uploadId]/confirm/route.ts
// POST /api/tournaments/:id/imports/:uploadId/confirm — apply the import in one transaction (SRS-IMP-10), after
// re-validating; requires the second confirmation when boards with results are replaced (SRS-IMP-09); logs the
// import (SRS-IMP-11) and saves the mapping (SRS-IMP-04). TECHNICAL only; honours Idempotency-Key.

import { createApiRouteHandler } from "@/server/http/api-route-handler";
import { confirmImport } from "@/server/services/pairing-import-service";
import { importConfirmInputSchema } from "@/server/validation/import-export-input-schemas";

/**
 * Confirms the import.
 *
 * @returns 200 { roundNumber, gameCount, pairingImportId }; 409 IMPORT_NOT_READY / IMPORT_REPLACEMENT_NOT_CONFIRMED;
 *   400/404 as for the preview.
 */
export const POST = createApiRouteHandler<{ tournamentId: string; uploadId: string }>(
  "IMPORT_PAIRINGS",
  async ({ requestBody, routeParams, signedInUser, database }) => {
    const confirmation = importConfirmInputSchema.parse(requestBody);
    const importOutcome = await confirmImport(routeParams.tournamentId, { ...confirmation, uploadId: routeParams.uploadId }, signedInUser, database);
    return { status: 200, body: { ...importOutcome } };
  },
);
