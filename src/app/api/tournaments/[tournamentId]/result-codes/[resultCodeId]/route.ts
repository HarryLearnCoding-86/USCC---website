// src/app/api/tournaments/[tournamentId]/result-codes/[resultCodeId]/route.ts
// PATCH — change or hide a result code; DELETE — remove an unused one (TECHNICAL, SRS-TOUR-05, SRS-TOUR-07).

import { createApiRouteHandler } from "@/server/http/api-route-handler";
import { toJsonBody } from "@/server/http/json-body";
import { deleteResultCode, updateResultCode } from "@/server/services/result-code-service";
import { updateResultCodeInputSchema } from "@/server/validation/phase-two-input-schemas";

type ResultCodeRouteParams = { tournamentId: string; resultCodeId: string };

/**
 * Updates fields of a code.
 *
 * @returns 200 { resultCode }; 404; 409 RESULT_CODE_IN_USE / RESULT_CODE_TAKEN.
 */
export const PATCH = createApiRouteHandler<ResultCodeRouteParams>("MANAGE_TOURNAMENTS", async ({ requestBody, routeParams, database }) => {
  const updateInput = updateResultCodeInputSchema.parse(requestBody);
  const resultCode = await updateResultCode(routeParams.tournamentId, routeParams.resultCodeId, updateInput, database);
  return { status: 200, body: { resultCode: toJsonBody(resultCode) } };
});

/**
 * Deletes an unused code.
 *
 * @returns 200 { deleted: true }; 404; 409 RESULT_CODE_IN_USE.
 */
export const DELETE = createApiRouteHandler<ResultCodeRouteParams>("MANAGE_TOURNAMENTS", async ({ routeParams, database }) => {
  await deleteResultCode(routeParams.tournamentId, routeParams.resultCodeId, database);
  return { status: 200, body: { deleted: true } };
});
