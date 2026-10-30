// src/app/api/games/[gameId]/edit/route.ts
// POST /api/games/:gameId/edit — TD changes the result code; the result needs reconfirmation (SRS-SM-07, RULE-09).

import { createResultActionRoute } from "@/server/http/result-action-route";
import { editResultInputSchema } from "@/server/validation/phase-two-input-schemas";

/**
 * Edits with { resultCodeId, reason, version }.
 *
 * @returns 200 { game }; 400 REASON_TOO_SHORT; 403 for recorders; 409 per state machine.
 */
export const POST = createResultActionRoute("RESOLVE_RESULTS", editResultInputSchema, (parsedBody) => ({
  type: "EDIT_RESULT",
  resultCodeId: parsedBody.resultCodeId,
  reason: parsedBody.reason,
}));
