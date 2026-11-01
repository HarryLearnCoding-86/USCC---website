// src/server/services/result-lifecycle-service.ts
// Applies one result action in one transaction (SRS-SM-09): lock the result row, check the client's version
// (409 on a stale one, SRS-SM-10), ask the state machine for the next state, persist it with version + 1,
// append a result_events row (SRS-AUD-01, 03) and NOTIFY result_changed for live screens.
// This is the only place results are written; the status always comes from result-state-machine.ts.

import type { Prisma } from "@prisma/client";
import { vi } from "@/i18n/vi";
import type { DatabaseClient } from "@/server/database/database-client";
import {
  evaluateResultTransition,
  MINIMUM_REASON_LENGTH,
  type PlayerSide,
  type ResultAction,
  type ResultCodeFacts,
  type ResultState,
  type TransitionRefusal,
} from "@/server/domain/result-state-machine";
import type { SignedInUser } from "@/server/auth/session-store";
import { ApiError } from "@/server/http/api-error";
import { notifyResultChanged } from "@/server/services/change-notifier";
import { getGameView } from "@/server/services/game-query-service";
import type { GameView } from "@/server/services/game-view-mapper";

/** An action as received from the API: result codes by ID, not yet resolved. */
export type ResultActionRequest =
  | { type: "SUBMIT_RESULT"; resultCodeId: string }
  | { type: "CONFIRM_BY_SIDE"; side: PlayerSide }
  | { type: "REJECT_BY_SIDE"; side: PlayerSide }
  | { type: "APPROVE_EXCEPTION"; resultCodeId: string | null; reason: string }
  | { type: "REOPEN"; reason: string }
  | { type: "EDIT_RESULT"; resultCodeId: string; reason: string }
  | { type: "CANCEL"; reason: string };

/** One command to the lifecycle. */
export interface ResultTransitionCommand {
  gameId: string;
  /** The version the client last saw; must equal the stored version. */
  expectedVersion: number;
  actionRequest: ResultActionRequest;
  actor: SignedInUser;
}

/**
 * Applies a result action inside the caller's transaction.
 *
 * @param command - Game, expected version, action and actor.
 * @param database - Transaction client; the route wrapper supplies one shared with the idempotency record.
 * @param now - Current time; injectable for tests.
 * @returns The updated game view.
 * @throws ApiError 404 GAME_NOT_FOUND, 409 VERSION_CONFLICT / INVALID_TRANSITION / SIDE_ALREADY_DECIDED,
 *   403 ROLE_NOT_ALLOWED, 400 REASON_TOO_SHORT / RESULT_CODE_NOT_ALLOWED / RESULT_CODE_NOT_FOUND / RESULT_CODE_INACTIVE.
 */
export async function applyResultTransition(
  command: ResultTransitionCommand,
  database: DatabaseClient,
  now: Date = new Date(),
): Promise<GameView> {
  const game = await database.game.findUnique({
    where: { id: command.gameId },
    select: { id: true, blackPlayerId: true, boardNumber: true, round: { select: { tournamentId: true, roundNumber: true } } },
  });
  if (!game) {
    throw new ApiError(404, "GAME_NOT_FOUND", vi.resultErrors.gameNotFound);
  }
  const lockedResult = await lockResultRow(game.id, database);
  // SRS-SM-10: optimistic lock — two recorders on the same board, or a TD edit during a confirmation (RISK-04).
  if (lockedResult.version !== command.expectedVersion) {
    throw new ApiError(409, "VERSION_CONFLICT", vi.apiErrors.versionConflict, { currentVersion: lockedResult.version });
  }

  const action = await resolveAction(command.actionRequest, game.round.tournamentId, database);
  const outcome = evaluateResultTransition({
    currentState: lockedResult,
    action,
    actor: { userId: command.actor.id, role: command.actor.role },
    game: { isBye: game.blackPlayerId === null },
    now,
  });
  if (!outcome.isAllowed) {
    throw convertRefusalToApiError(outcome.refusal);
  }

  const nextVersion = lockedResult.version + 1;
  await database.result.update({ where: { id: lockedResult.id }, data: { ...outcome.nextState, version: nextVersion } });
  await database.resultEvent.create({
    data: {
      resultId: lockedResult.id,
      actorUserId: command.actor.id,
      action: outcome.eventAction,
      oldValue: await buildAuditSnapshot(lockedResult, lockedResult.version, database),
      newValue: await buildAuditSnapshot(outcome.nextState, nextVersion, database),
      reason: outcome.reason,
    },
  });
  await notifyResultChanged(
    { tournamentId: game.round.tournamentId, roundNumber: game.round.roundNumber, gameId: game.id, status: outcome.nextState.status, version: nextVersion },
    database,
  );
  return getGameView(game.id, database);
}

/**
 * Ensures the game has a result row and locks it until the transaction ends, so concurrent actions on the same
 * board are serialised and the version check is reliable.
 *
 * @param gameId - Game ID.
 * @param database - Transaction client.
 * @returns The locked result's state, ID and version.
 */
async function lockResultRow(gameId: string, database: DatabaseClient): Promise<ResultState & { id: string; version: number }> {
  // Games normally get a NONE result when created; create one if an older game lacks it.
  await database.$executeRaw`
    INSERT INTO results (id, game_id, status, version, updated_at)
    VALUES (gen_random_uuid()::text, ${gameId}, 'NONE', 0, now())
    ON CONFLICT (game_id) DO NOTHING`;
  const [lockedRow] = await database.$queryRaw<{ id: string }[]>`SELECT id FROM results WHERE game_id = ${gameId} FOR UPDATE`;
  if (!lockedRow) {
    throw new ApiError(404, "GAME_NOT_FOUND", vi.resultErrors.gameNotFound);
  }
  return database.result.findUniqueOrThrow({
    where: { id: lockedRow.id },
    select: {
      id: true,
      version: true,
      status: true,
      resultCodeId: true,
      whiteConfirmedAt: true,
      blackConfirmedAt: true,
      disputedBySide: true,
      disputedAt: true,
      enteredByUserId: true,
      approvedByUserId: true,
      approvalReason: true,
    },
  });
}

/**
 * Turns an API action into a state machine action by loading the referenced result codes.
 *
 * @param actionRequest - Action from the API.
 * @param tournamentId - Codes must belong to this tournament.
 * @param database - Transaction client.
 * @returns The resolved action.
 * @throws ApiError 400 when a code is unknown or hidden.
 */
async function resolveAction(actionRequest: ResultActionRequest, tournamentId: string, database: DatabaseClient): Promise<ResultAction> {
  switch (actionRequest.type) {
    case "SUBMIT_RESULT":
      return { type: "SUBMIT_RESULT", resultCode: await loadActiveResultCode(actionRequest.resultCodeId, tournamentId, database) };
    case "EDIT_RESULT":
      return {
        type: "EDIT_RESULT",
        resultCode: await loadActiveResultCode(actionRequest.resultCodeId, tournamentId, database),
        reason: actionRequest.reason,
      };
    case "APPROVE_EXCEPTION":
      return {
        type: "APPROVE_EXCEPTION",
        resultCode: actionRequest.resultCodeId ? await loadActiveResultCode(actionRequest.resultCodeId, tournamentId, database) : null,
        reason: actionRequest.reason,
      };
    default:
      return actionRequest;
  }
}

/**
 * Loads an active result code of the tournament.
 *
 * @param resultCodeId - Code ID from the request.
 * @param tournamentId - Owning tournament.
 * @param database - Transaction client.
 * @returns The facts the state machine needs.
 * @throws ApiError 400 RESULT_CODE_NOT_FOUND or RESULT_CODE_INACTIVE (SRS-TOUR-07: hidden codes take no new entries).
 */
async function loadActiveResultCode(resultCodeId: string, tournamentId: string, database: DatabaseClient): Promise<ResultCodeFacts> {
  const resultCode = await database.resultCode.findFirst({ where: { id: resultCodeId, tournamentId } });
  if (!resultCode) {
    throw new ApiError(400, "RESULT_CODE_NOT_FOUND", vi.resultCodes.notFound);
  }
  if (!resultCode.isActive) {
    throw new ApiError(400, "RESULT_CODE_INACTIVE", vi.resultCodes.inactive);
  }
  return { id: resultCode.id, requiresPlayerConfirmation: resultCode.requiresPlayerConfirmation };
}

/**
 * Maps a state machine refusal to the HTTP error of SRS-SM-11.
 *
 * @param refusal - Why the transition was refused.
 * @returns The ApiError to throw.
 */
function convertRefusalToApiError(refusal: TransitionRefusal): ApiError {
  switch (refusal) {
    case "INVALID_TRANSITION":
      return new ApiError(409, refusal, vi.resultErrors.invalidTransition);
    case "SIDE_ALREADY_DECIDED":
      return new ApiError(409, refusal, vi.resultErrors.sideAlreadyDecided);
    case "SIDE_NOT_PRESENT":
      return new ApiError(409, refusal, vi.resultErrors.sideNotPresent);
    case "ROLE_NOT_ALLOWED":
      return new ApiError(403, refusal, vi.auth.forbidden);
    case "REASON_TOO_SHORT":
      return new ApiError(400, refusal, vi.resultErrors.reasonTooShort(MINIMUM_REASON_LENGTH));
    case "RESULT_CODE_NOT_ALLOWED":
      return new ApiError(400, refusal, vi.resultErrors.resultCodeNotAllowed);
  }
}

/**
 * Builds the JSON stored in result_events.old_value / new_value: status, code (with its text, so the history
 * stays readable even if the code is later relabelled), confirmations, dispute, approval and version.
 *
 * @param resultState - State to snapshot.
 * @param version - Version number of that state.
 * @param database - Transaction client.
 * @returns JSON-safe snapshot.
 */
async function buildAuditSnapshot(resultState: ResultState, version: number, database: DatabaseClient): Promise<Prisma.InputJsonObject> {
  const resultCode = resultState.resultCodeId
    ? await database.resultCode.findUnique({ where: { id: resultState.resultCodeId }, select: { code: true } })
    : null;
  return {
    status: resultState.status,
    version,
    resultCodeId: resultState.resultCodeId,
    resultCode: resultCode?.code ?? null,
    whiteConfirmedAt: resultState.whiteConfirmedAt?.toISOString() ?? null,
    blackConfirmedAt: resultState.blackConfirmedAt?.toISOString() ?? null,
    disputedBySide: resultState.disputedBySide,
    approvedByUserId: resultState.approvedByUserId,
    enteredByUserId: resultState.enteredByUserId,
  };
}
