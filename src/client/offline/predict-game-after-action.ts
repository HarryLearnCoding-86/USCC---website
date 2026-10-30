// src/client/offline/predict-game-after-action.ts
// Predicts a game's state after a queued action, so the recorder can carry on (White, then Black) while the venue
// network is down. It runs the same pure state machine as the server, so the prediction matches what the server
// will do when the queue replays — unless someone else changed the board meanwhile, in which case the replay is
// rejected with 409 and the arbiter is told (SRS-SYNC-04).

import type { Role } from "@prisma/client";
import { evaluateResultTransition, isOfficialByDoubleConfirmation, type ResultAction, type ResultState } from "@/server/domain/result-state-machine";
import type { GameView, ResultCodeView } from "@/server/services/game-view-mapper";

/** Recorder actions that can be queued. */
export type QueueableResultAction =
  | { type: "SUBMIT_RESULT"; resultCodeId: string }
  | { type: "CONFIRM_BY_SIDE"; side: "WHITE" | "BLACK" }
  | { type: "REJECT_BY_SIDE"; side: "WHITE" | "BLACK" };

/** The arbiter holding the phone; the username stands in for the user ID in the predicted view. */
export interface PredictionActor {
  username: string;
  role: Role;
}

/**
 * Converts a nullable ISO string to a Date.
 *
 * @param isoText - ISO timestamp or null.
 * @returns Date or null.
 */
function toDateOrNull(isoText: string | null): Date | null {
  return isoText === null ? null : new Date(isoText);
}

/**
 * Predicts the game after an action.
 *
 * @param game - Current (possibly already predicted) game.
 * @param queueableAction - The action being queued.
 * @param resultCodes - Tournament codes, to resolve resultCodeId.
 * @param actor - Arbiter performing it.
 * @param now - Current time.
 * @returns The predicted game with version + 1, or null when the state machine refuses the action.
 */
export function predictGameAfterAction(
  game: GameView,
  queueableAction: QueueableResultAction,
  resultCodes: ResultCodeView[],
  actor: PredictionActor,
  now: Date,
): GameView | null {
  const currentState: ResultState = {
    status: game.result.status,
    resultCodeId: game.result.resultCode?.id ?? null,
    whiteConfirmedAt: toDateOrNull(game.result.whiteConfirmedAt),
    blackConfirmedAt: toDateOrNull(game.result.blackConfirmedAt),
    disputedBySide: game.result.disputedBySide,
    disputedAt: toDateOrNull(game.result.disputedAt),
    // The view carries usernames, not IDs; they only need to be non-null to keep their meaning.
    enteredByUserId: game.result.enteredByUsername,
    approvedByUserId: game.result.approvedByUsername,
    approvalReason: game.result.approvalReason,
  };
  let action: ResultAction;
  if (queueableAction.type === "SUBMIT_RESULT") {
    const resultCode = resultCodes.find((candidateCode) => candidateCode.id === queueableAction.resultCodeId);
    if (!resultCode) return null;
    action = { type: "SUBMIT_RESULT", resultCode: { id: resultCode.id, requiresPlayerConfirmation: resultCode.requiresPlayerConfirmation } };
  } else {
    action = queueableAction;
  }

  const outcome = evaluateResultTransition({
    currentState,
    action,
    actor: { userId: actor.username, role: actor.role },
    game: { isBye: game.black === null },
    now,
  });
  if (!outcome.isAllowed) {
    return null;
  }
  const { nextState } = outcome;
  return {
    ...game,
    result: {
      status: nextState.status,
      version: game.result.version + 1,
      resultCode: resultCodes.find((candidateCode) => candidateCode.id === nextState.resultCodeId) ?? null,
      whiteConfirmedAt: nextState.whiteConfirmedAt?.toISOString() ?? null,
      blackConfirmedAt: nextState.blackConfirmedAt?.toISOString() ?? null,
      disputedBySide: nextState.disputedBySide,
      disputedAt: nextState.disputedAt?.toISOString() ?? null,
      enteredByUsername: nextState.enteredByUserId,
      approvedByUsername: nextState.approvedByUserId,
      approvalReason: nextState.approvalReason,
      isOfficialByDoubleConfirmation: isOfficialByDoubleConfirmation(nextState),
    },
  };
}
