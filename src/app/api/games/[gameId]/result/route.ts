// src/app/api/games/[gameId]/result/route.ts
// POST /api/games/:gameId/result — submit a result (SRS-SM-01, SRS-SM-04, SRS-RES-04). RECORDER or TECHNICAL.

import { createResultActionRoute } from "@/server/http/result-action-route";
import { submitResultInputSchema } from "@/server/validation/phase-two-input-schemas";

/**
 * Submits { resultCodeId, version }.
 *
 * @returns 200 { game }; 409 VERSION_CONFLICT / INVALID_TRANSITION; 403 when a recorder picks a TD-only code.
 */
export const POST = createResultActionRoute("SUBMIT_RESULTS", submitResultInputSchema, (parsedBody) => ({
  type: "SUBMIT_RESULT",
  resultCodeId: parsedBody.resultCodeId,
}));
