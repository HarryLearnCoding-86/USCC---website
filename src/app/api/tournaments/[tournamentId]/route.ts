// src/app/api/tournaments/[tournamentId]/route.ts
// GET /api/tournaments/:id — tournament settings (both roles); PATCH — update them (TECHNICAL, SRS-TOUR-04).

import { createApiRouteHandler } from "@/server/http/api-route-handler";
import { toJsonBody } from "@/server/http/json-body";
import { getTournamentSettings, updateTournament } from "@/server/services/tournament-service";
import { tournamentInputSchema } from "@/server/validation/phase-two-input-schemas";

/**
 * Returns the settings.
 *
 * @returns 200 { tournament }; 404 TOURNAMENT_NOT_FOUND.
 */
export const GET = createApiRouteHandler<{ tournamentId: string }>("LOOK_UP_GAMES", async ({ routeParams, database }) => {
  const tournament = await getTournamentSettings(routeParams.tournamentId, database);
  return { status: 200, body: { tournament: toJsonBody(tournament) } };
});

/**
 * Replaces the editable fields.
 *
 * @returns 200 { tournament }; 400 invalid body; 404; 409 ROUNDS_HAVE_GAMES.
 */
export const PATCH = createApiRouteHandler<{ tournamentId: string }>("MANAGE_TOURNAMENTS", async ({ requestBody, routeParams, database }) => {
  const tournament = await updateTournament(routeParams.tournamentId, tournamentInputSchema.parse(requestBody), database);
  return { status: 200, body: { tournament: toJsonBody(tournament) } };
});
