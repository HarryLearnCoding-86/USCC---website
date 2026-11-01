// src/app/api/games/[gameId]/confirm/route.ts
// POST /api/games/:gameId/confirm — a player's "Xác nhận" or "Không đồng ý" tap on the recorder's phone
// (SRS-SM-02, SRS-SM-03, SRS-CONF-05..07). The recorder account holding the phone is logged as actor (SRS-CONF-10).

import { createResultActionRoute } from "@/server/http/result-action-route";
import { confirmResultInputSchema } from "@/server/validation/phase-two-input-schemas";

/**
 * Applies { side, decision, version }.
 *
 * @returns 200 { game }; 409 VERSION_CONFLICT / INVALID_TRANSITION / SIDE_ALREADY_DECIDED.
 */
export const POST = createResultActionRoute("SUBMIT_RESULTS", confirmResultInputSchema, (parsedBody) =>
  parsedBody.decision === "CONFIRM"
    ? { type: "CONFIRM_BY_SIDE", side: parsedBody.side }
    : { type: "REJECT_BY_SIDE", side: parsedBody.side },
);
