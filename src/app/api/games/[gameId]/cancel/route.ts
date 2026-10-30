// src/app/api/games/[gameId]/cancel/route.ts
// POST /api/games/:gameId/cancel — TD cancels a result back to NONE (SRS-SM-08, SRS-TD-04).

import { createResultActionRoute } from "@/server/http/result-action-route";
import { reasonOnlyInputSchema } from "@/server/validation/phase-two-input-schemas";

/**
 * Cancels with { reason, version }.
 *
 * @returns 200 { game }; 400 REASON_TOO_SHORT; 403 for recorders; 409 per state machine.
 */
export const POST = createResultActionRoute("RESOLVE_RESULTS", reasonOnlyInputSchema, (parsedBody) => ({
  type: "CANCEL",
  reason: parsedBody.reason,
}));
