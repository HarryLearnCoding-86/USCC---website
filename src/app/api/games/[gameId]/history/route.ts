// src/app/api/games/[gameId]/history/route.ts
// GET /api/games/:gameId/history — the game's audit events in time order (SRS-TD-05). TECHNICAL only.

import { createApiRouteHandler } from "@/server/http/api-route-handler";
import { toJsonBody } from "@/server/http/json-body";
import { listGameHistory } from "@/server/services/game-query-service";

/**
 * Returns the history.
 *
 * @returns 200 { history }; 404 GAME_NOT_FOUND.
 */
export const GET = createApiRouteHandler<{ gameId: string }>("RESOLVE_RESULTS", async ({ routeParams }) => {
  const history = await listGameHistory(routeParams.gameId);
  return { status: 200, body: { history: toJsonBody(history) } };
});
