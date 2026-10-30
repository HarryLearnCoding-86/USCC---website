// src/app/api/tournaments/[tournamentId]/rounds/[roundNumber]/games/route.ts
// GET — a round's games with ?search= and ?status= (both roles, SRS-LOOK-01..03);
// POST — add a board manually (TECHNICAL, SRS-IMP-13).

import { createApiRouteHandler } from "@/server/http/api-route-handler";
import { toJsonBody } from "@/server/http/json-body";
import { listRoundGames } from "@/server/services/game-query-service";
import { saveManualBoard } from "@/server/services/manual-pairing-service";
import { manualPairingInputSchema, positiveIntegerParamSchema, roundGamesQuerySchema } from "@/server/validation/phase-two-input-schemas";

type RoundRouteParams = { tournamentId: string; roundNumber: string };

/**
 * Lists matching games by board.
 *
 * @returns 200 { games }; 404 ROUND_NOT_FOUND.
 */
export const GET = createApiRouteHandler<RoundRouteParams>("LOOK_UP_GAMES", async ({ request, routeParams, database }) => {
  const query = roundGamesQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const games = await listRoundGames(routeParams.tournamentId, positiveIntegerParamSchema.parse(routeParams.roundNumber), query, database);
  return { status: 200, body: { games: toJsonBody(games) } };
});

/**
 * Adds a board.
 *
 * @returns 201 { game }; 400 PAIRING_INVALID; 404; 409 DUPLICATE_BOARD.
 */
export const POST = createApiRouteHandler<RoundRouteParams>("MANAGE_TOURNAMENTS", async ({ requestBody, routeParams, database }) => {
  const game = await saveManualBoard(
    { tournamentId: routeParams.tournamentId, roundNumber: positiveIntegerParamSchema.parse(routeParams.roundNumber), originalBoardNumber: null },
    manualPairingInputSchema.parse(requestBody),
    database,
  );
  return { status: 201, body: { game: toJsonBody(game) } };
});
