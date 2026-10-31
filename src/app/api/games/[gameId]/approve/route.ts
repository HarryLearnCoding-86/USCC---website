// src/app/api/games/[gameId]/approve/route.ts
// POST /api/games/:gameId/approve — TD exception approval of a PENDING or DISPUTED result (SRS-SM-05, SRS-TD-03).

import { createResultActionRoute } from "@/server/http/result-action-route";
import { approveResultInputSchema } from "@/server/validation/phase-two-input-schemas";

/**
 * Approves with { resultCodeId?, reason, version }.
 *
 * @returns 200 { game }; 400 REASON_TOO_SHORT; 403 for recorders; 409 per state machine.
 */
export const POST = createResultActionRoute("RESOLVE_RESULTS", approveResultInputSchema, (parsedBody) => ({
  type: "APPROVE_EXCEPTION",
  resultCodeId: parsedBody.resultCodeId,
  reason: parsedBody.reason,
}));
