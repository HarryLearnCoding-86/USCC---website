// src/app/api/tournaments/[tournamentId]/rounds/[roundNumber]/games/[boardNumber]/route.ts
// PUT — replace a board's pairing; DELETE — remove a board that never had a result (TECHNICAL, SRS-IMP-13).

import { createApiRouteHandler } from "@/server/http/api-route-handler";
import { toJsonBody } from "@/server/http/json-body";
import { deleteManualBoard, saveManualBoard } from "@/server/services/manual-pairing-service";
import { manualPairingInputSchema, positiveIntegerParamSchema } from "@/server/validation/phase-two-input-schemas";

type BoardRouteParams = { tournamentId: string; roundNumber: string; boardNumber: string };

/**
 * Replaces the board identified by the URL; the body may change the board number.
 *
 * @returns 200 { game }; 400 PAIRING_INVALID; 404; 409 GAME_HAS_RESULT / DUPLICATE_BOARD.
 */
export const PUT = createApiRouteHandler<BoardRouteParams>("MANAGE_TOURNAMENTS", async ({ requestBody, routeParams, database }) => {
  const game = await saveManualBoard(
    {
      tournamentId: routeParams.tournamentId,
      roundNumber: positiveIntegerParamSchema.parse(routeParams.roundNumber),
      originalBoardNumber: positiveIntegerParamSchema.parse(routeParams.boardNumber),
    },
    manualPairingInputSchema.parse(requestBody),
    database,
  );
  return { status: 200, body: { game: toJsonBody(game) } };
});

/**
 * Deletes the board.
 *
 * @returns 200 { deleted: true }; 404; 409 GAME_HAS_RESULT / GAME_HAS_HISTORY.
 */
export const DELETE = createApiRouteHandler<BoardRouteParams>("MANAGE_TOURNAMENTS", async ({ routeParams, database }) => {
  await deleteManualBoard(
    {
      tournamentId: routeParams.tournamentId,
      roundNumber: positiveIntegerParamSchema.parse(routeParams.roundNumber),
      originalBoardNumber: positiveIntegerParamSchema.parse(routeParams.boardNumber),
    },
    database,
  );
  return { status: 200, body: { deleted: true } };
});
