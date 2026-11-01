// src/app/api/tournaments/[tournamentId]/projection/route.ts
// GET /api/tournaments/:id/projection?round=n — projection data with official results only (SRS-PROJ-01..08).
// TECHNICAL only (SRS-PROJ-01); the projection page refetches this after every live event and reconnect.

import { createApiRouteHandler } from "@/server/http/api-route-handler";
import { toJsonBody } from "@/server/http/json-body";
import { getProjectionView } from "@/server/services/projection-service";

/**
 * Returns the projection view.
 *
 * @returns 200 { projection }; 404 TOURNAMENT_NOT_FOUND; 401/403 per guards.
 */
export const GET = createApiRouteHandler<{ tournamentId: string }>("VIEW_PROJECTION", async ({ request, routeParams }) => {
  const requestedRound = Number(request.nextUrl.searchParams.get("round"));
  const projection = await getProjectionView(routeParams.tournamentId, Number.isInteger(requestedRound) && requestedRound > 0 ? requestedRound : null);
  return { status: 200, body: { projection: toJsonBody(projection) } };
});
