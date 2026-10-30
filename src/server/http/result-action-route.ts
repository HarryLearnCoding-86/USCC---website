// src/server/http/result-action-route.ts
// Factory for the six result-action endpoints (POST /api/games/:id/result|confirm|approve|reopen|edit|cancel,
// SRS §10.2). Each one validates its body, maps it to a lifecycle action and runs applyResultTransition inside
// the idempotent transaction provided by createApiRouteHandler.

import type { z } from "zod";
import type { Permission } from "@/server/auth/role-permissions";
import { createApiRouteHandler } from "@/server/http/api-route-handler";
import { toJsonBody } from "@/server/http/json-body";
import { applyResultTransition, type ResultActionRequest } from "@/server/services/result-lifecycle-service";

/**
 * Builds a POST handler for one result action.
 *
 * @param requiredPermission - SUBMIT_RESULTS for recorder actions, RESOLVE_RESULTS for TD actions.
 * @param bodySchema - Zod schema of the body; must include `version`.
 * @param toActionRequest - Maps the parsed body to a lifecycle action.
 * @returns A Next.js route handler responding 200 { game }.
 */
export function createResultActionRoute<TBody extends { version: number }>(
  requiredPermission: Permission,
  bodySchema: z.ZodType<TBody, z.ZodTypeDef, unknown>,
  toActionRequest: (parsedBody: TBody) => ResultActionRequest,
) {
  return createApiRouteHandler<{ gameId: string }>(requiredPermission, async ({ requestBody, routeParams, signedInUser, database }) => {
    const parsedBody = bodySchema.parse(requestBody);
    const game = await applyResultTransition(
      { gameId: routeParams.gameId, expectedVersion: parsedBody.version, actionRequest: toActionRequest(parsedBody), actor: signedInUser },
      database,
    );
    return { status: 200, body: { game: toJsonBody(game) } };
  });
}
