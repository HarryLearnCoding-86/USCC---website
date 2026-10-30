// src/app/api/games/[gameId]/reopen/route.ts
// POST /api/games/:gameId/reopen — TD reopens an OFFICIAL result for correction (SRS-SM-06, SRS-TD-04).

import { createResultActionRoute } from "@/server/http/result-action-route";
import { reasonOnlyInputSchema } from "@/server/validation/phase-two-input-schemas";

/**
 * Reopens with { reason, version }.
 *
 * @returns 200 { game }; 400 REASON_TOO_SHORT; 403 for recorders; 409 per state machine.
 */
export const POST = createResultActionRoute("RESOLVE_RESULTS", reasonOnlyInputSchema, (parsedBody) => ({
  type: "REOPEN",
  reason: parsedBody.reason,
}));
