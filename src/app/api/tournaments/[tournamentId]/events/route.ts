// src/app/api/tournaments/[tournamentId]/events/route.ts
// GET /api/tournaments/:id/events — Server-Sent Events stream of result and tournament changes with a 15 s
// heartbeat (AGENT_PROMPT.md §3.6, SRS §10.2). Both roles. Node runtime: the stream relies on the in-process
// PostgreSQL listener.

import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-cookie";
import { findSignedInUserBySessionToken } from "@/server/auth/session-store";
import { authorizeApiRequest, convertErrorToResponse } from "@/server/http/api-route-handler";
import { openTournamentEventStream } from "@/server/realtime/server-sent-events";
import { getTournamentSummary } from "@/server/services/game-query-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Opens the event stream after checking session, role and that the tournament exists.
 *
 * @param request - Incoming request (EventSource sends the session cookie).
 * @param routeContext - Route params with tournamentId.
 * @returns The event stream, or a JSON error (401, 403, 404).
 */
export async function GET(request: NextRequest, routeContext: { params: Promise<{ tournamentId: string }> }): Promise<Response> {
  try {
    await authorizeApiRequest(request, "LOOK_UP_GAMES");
    const { tournamentId } = await routeContext.params;
    await getTournamentSummary(tournamentId);
    const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? "";
    return await openTournamentEventStream({
      tournamentId,
      abortSignal: request.signal,
      isSessionStillValid: async () => (await findSignedInUserBySessionToken(sessionToken)) !== null,
    });
  } catch (error) {
    return convertErrorToResponse(error);
  }
}
