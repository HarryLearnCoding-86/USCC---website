// src/app/api/games/[gameId]/route.ts
// GET /api/games/:gameId — one game with players and result, for the record page and retries. Both roles.

import { createApiRouteHandler } from "@/server/http/api-route-handler";
import { toJsonBody } from "@/server/http/json-body";
import { getGameView } from "@/server/services/game-query-service";

/**
 * Returns the game.
 *
 * @returns 200 { game }; 404 GAME_NOT_FOUND.
 */
export const GET = createApiRouteHandler<{ gameId: string }>("LOOK_UP_GAMES", async ({ routeParams, database }) => {
  const game = await getGameView(routeParams.gameId, database);
  return { status: 200, body: { game: toJsonBody(game) } };
});
