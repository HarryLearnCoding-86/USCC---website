// src/app/api/tournaments/[tournamentId]/result-codes/route.ts
// GET — list result codes (both roles); POST — add one (TECHNICAL, SRS-TOUR-05).

import { createApiRouteHandler } from "@/server/http/api-route-handler";
import { toJsonBody } from "@/server/http/json-body";
import { listResultCodes } from "@/server/services/game-query-service";
import { createResultCode } from "@/server/services/result-code-service";
import { createResultCodeInputSchema } from "@/server/validation/phase-two-input-schemas";

/**
 * Lists codes in display order.
 *
 * @returns 200 { resultCodes }.
 */
export const GET = createApiRouteHandler<{ tournamentId: string }>("LOOK_UP_GAMES", async ({ routeParams, database }) => {
  const resultCodes = await listResultCodes(routeParams.tournamentId, database);
  return { status: 200, body: { resultCodes: toJsonBody(resultCodes) } };
});

/**
 * Adds a code.
 *
 * @returns 201 { resultCode }; 400 invalid body; 404; 409 RESULT_CODE_TAKEN.
 */
export const POST = createApiRouteHandler<{ tournamentId: string }>("MANAGE_TOURNAMENTS", async ({ requestBody, routeParams, database }) => {
  const resultCode = await createResultCode(routeParams.tournamentId, createResultCodeInputSchema.parse(requestBody), database);
  return { status: 201, body: { resultCode: toJsonBody(resultCode) } };
});
