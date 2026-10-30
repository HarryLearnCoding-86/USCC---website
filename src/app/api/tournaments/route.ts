// src/app/api/tournaments/route.ts
// GET /api/tournaments — list tournaments (both roles); POST — create one (TECHNICAL, SRS-TOUR-01).

import { createApiRouteHandler } from "@/server/http/api-route-handler";
import { toJsonBody } from "@/server/http/json-body";
import { createTournament } from "@/server/services/tournament-service";
import { listTournamentsWithRounds } from "@/server/services/tournament-query-service";
import { tournamentInputSchema } from "@/server/validation/phase-two-input-schemas";

/**
 * Lists tournaments.
 *
 * @returns 200 { tournaments }.
 */
export const GET = createApiRouteHandler("LOOK_UP_GAMES", async () => {
  const tournaments = await listTournamentsWithRounds();
  return { status: 200, body: { tournaments: toJsonBody(tournaments) } };
});

/**
 * Creates a tournament with its rounds and default result codes.
 *
 * @returns 201 { tournament }; 400 invalid body.
 */
export const POST = createApiRouteHandler("MANAGE_TOURNAMENTS", async ({ requestBody, database }) => {
  const tournament = await createTournament(tournamentInputSchema.parse(requestBody), database);
  return { status: 201, body: { tournament: toJsonBody(tournament) } };
});
