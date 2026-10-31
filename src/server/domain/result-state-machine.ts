// src/server/domain/result-state-machine.ts
// The result lifecycle state machine (AGENT_PROMPT.md §3.3, SRS §7). This is the ONLY code that decides a
// result's next status; services persist what it returns and never set a status themselves (CLAUDE.md §2).
// Pure: no database, no HTTP, no clock — callers pass the current time — so every transition is unit-testable.

import type { ResultStatus, Role } from "@prisma/client";

/** Board side of a player. */
export type PlayerSide = "WHITE" | "BLACK";

/** Minimum length of every TD reason after trimming (SRS-SM-05 to SRS-SM-08). */
export const MINIMUM_REASON_LENGTH = 5;

/** The persisted fields of a result that the state machine reads and writes. */
export interface ResultState {
  status: ResultStatus;
  resultCodeId: string | null;
  whiteConfirmedAt: Date | null;
  blackConfirmedAt: Date | null;
  disputedBySide: PlayerSide | null;
  disputedAt: Date | null;
  enteredByUserId: string | null;
  approvedByUserId: string | null;
  approvalReason: string | null;
}

/** The parts of a result code the rules depend on. */
export interface ResultCodeFacts {
  id: string;
  /** false for byes and forfeits: no two-player confirmation is possible (SRS-SM-04). */
  requiresPlayerConfirmation: boolean;
}

/** Who performs the action: the logged-in arbiter (for confirmations, the recorder holding the phone). */
export interface TransitionActor {
  userId: string;
  role: Role;
}

/** Facts about the game that constrain which results are possible. */
export interface GameFacts {
  /** true when the game has no Black player. */
  isBye: boolean;
}

/** Every action the lifecycle supports, one per row of SRS §7. */
export type ResultAction =
  | { type: "SUBMIT_RESULT"; resultCode: ResultCodeFacts }
  | { type: "CONFIRM_BY_SIDE"; side: PlayerSide }
  | { type: "REJECT_BY_SIDE"; side: PlayerSide }
  | { type: "APPROVE_EXCEPTION"; resultCode: ResultCodeFacts | null; reason: string }
  | { type: "REOPEN"; reason: string }
  | { type: "EDIT_RESULT"; resultCode: ResultCodeFacts; reason: string }
  | { type: "CANCEL"; reason: string };

/** Audit action names written to result_events.action. */
export type ResultEventAction =
  | "SUBMIT_RESULT"
  | "CONFIRM_WHITE"
  | "CONFIRM_BLACK"
  | "REJECT_WHITE"
  | "REJECT_BLACK"
  | "APPROVE_EXCEPTION"
  | "REOPEN"
  | "EDIT_RESULT"
  | "CANCEL";

/** Why a transition was refused. Services map these to HTTP 409 / 403 / 400. */
export type TransitionRefusal =
  /** The action is not allowed from the current status (409, SRS-SM-11). */
  | "INVALID_TRANSITION"
  /** The caller's role may not perform the action (403, SRS-SM-11). */
  | "ROLE_NOT_ALLOWED"
  /** The side already confirmed or the result is no longer pending for it (409, SRS-CONF-05). */
  | "SIDE_ALREADY_DECIDED"
  /** A bye game has no Black player to confirm or reject (409). */
  | "SIDE_NOT_PRESENT"
  /** TD reason shorter than MINIMUM_REASON_LENGTH (400). */
  | "REASON_TOO_SHORT"
  /** The code needs two players but the game is a bye, or a recorder chose a TD-only code (400 / 403). */
  | "RESULT_CODE_NOT_ALLOWED";

/** Outcome of evaluating an action. */
export type TransitionOutcome =
  | { isAllowed: true; nextState: ResultState; eventAction: ResultEventAction; reason: string | null }
  | { isAllowed: false; refusal: TransitionRefusal };

/** Everything needed to evaluate one action. */
export interface TransitionRequest {
  currentState: ResultState;
  action: ResultAction;
  actor: TransitionActor;
  game: GameFacts;
  now: Date;
}

/** A result with no code, confirmations, dispute or approval. Shared by "no result yet" and cancel. */
export const EMPTY_RESULT_STATE: ResultState = {
  status: "NONE",
  resultCodeId: null,
  whiteConfirmedAt: null,
  blackConfirmedAt: null,
  disputedBySide: null,
  disputedAt: null,
  enteredByUserId: null,
  approvedByUserId: null,
  approvalReason: null,
};

/** Statuses from which a result can be (re)submitted (SRS-SM-01, SRS-SM-04). */
const SUBMITTABLE_STATUSES: ReadonlySet<ResultStatus> = new Set(["NONE", "REOPENED"]);
/** Statuses the TD can approve as an exception (SRS-SM-05). */
const APPROVABLE_STATUSES: ReadonlySet<ResultStatus> = new Set(["PENDING", "DISPUTED"]);

/**
 * Evaluates an action against the current result and returns the next state, or why it is refused.
 *
 * @param transitionRequest - Current state, action, actor, game facts and current time.
 * @returns The allowed next state with its audit action, or the refusal reason. Never throws.
 */
export function evaluateResultTransition(transitionRequest: TransitionRequest): TransitionOutcome {
  const { action } = transitionRequest;
  switch (action.type) {
    case "SUBMIT_RESULT":
      return evaluateSubmit(transitionRequest, action.resultCode);
    case "CONFIRM_BY_SIDE":
      return evaluateConfirm(transitionRequest, action.side);
    case "REJECT_BY_SIDE":
      return evaluateReject(transitionRequest, action.side);
    case "APPROVE_EXCEPTION":
      return evaluateApprove(transitionRequest, action.resultCode, action.reason);
    case "REOPEN":
      return evaluateReopen(transitionRequest, action.reason);
    case "EDIT_RESULT":
      return evaluateEdit(transitionRequest, action.resultCode, action.reason);
    case "CANCEL":
      return evaluateCancel(transitionRequest, action.reason);
  }
}

/**
 * Whether a TD reason is long enough.
 *
 * @param reason - Free text entered by the TD.
 * @returns true when the trimmed text has at least MINIMUM_REASON_LENGTH characters.
 */
export function isReasonLongEnough(reason: string): boolean {
  return reason.trim().length >= MINIMUM_REASON_LENGTH;
}

/**
 * Checks that a result code fits the game: a bye has nobody to confirm, so it can only take a code that skips
 * player confirmation.
 *
 * @param resultCode - Code being applied.
 * @param game - Game facts.
 * @returns true when the code is usable for the game.
 */
function isResultCodeValidForGame(resultCode: ResultCodeFacts, game: GameFacts): boolean {
  return !(game.isBye && resultCode.requiresPlayerConfirmation);
}

/**
 * SRS-SM-01 / SRS-SM-04: submit from NONE or REOPENED. Codes needing confirmation go to PENDING with both
 * confirmations cleared; codes without (bye, forfeit) go straight to OFFICIAL and only a TD may submit them.
 */
function evaluateSubmit(transitionRequest: TransitionRequest, resultCode: ResultCodeFacts): TransitionOutcome {
  const { currentState, actor, game } = transitionRequest;
  if (!SUBMITTABLE_STATUSES.has(currentState.status)) {
    return { isAllowed: false, refusal: "INVALID_TRANSITION" };
  }
  if (!isResultCodeValidForGame(resultCode, game)) {
    return { isAllowed: false, refusal: "RESULT_CODE_NOT_ALLOWED" };
  }
  if (!resultCode.requiresPlayerConfirmation && actor.role !== "TECHNICAL") {
    return { isAllowed: false, refusal: "ROLE_NOT_ALLOWED" };
  }
  const nextState: ResultState = {
    ...EMPTY_RESULT_STATE,
    status: resultCode.requiresPlayerConfirmation ? "PENDING" : "OFFICIAL",
    resultCodeId: resultCode.id,
    enteredByUserId: actor.userId,
  };
  return { isAllowed: true, nextState, eventAction: "SUBMIT_RESULT", reason: null };
}

/**
 * SRS-SM-02: a side confirms once; the second confirmation makes the result OFFICIAL (FR-06).
 */
function evaluateConfirm(transitionRequest: TransitionRequest, side: PlayerSide): TransitionOutcome {
  const { currentState, game, now } = transitionRequest;
  const sideRefusal = findSideDecisionRefusal(currentState, game, side);
  if (sideRefusal) {
    return { isAllowed: false, refusal: sideRefusal };
  }
  const whiteConfirmedAt = side === "WHITE" ? now : currentState.whiteConfirmedAt;
  const blackConfirmedAt = side === "BLACK" ? now : currentState.blackConfirmedAt;
  // FR-06: OFFICIAL only once both players have confirmed.
  const isConfirmedByBoth = whiteConfirmedAt !== null && blackConfirmedAt !== null;
  const nextState: ResultState = {
    ...currentState,
    whiteConfirmedAt,
    blackConfirmedAt,
    status: isConfirmedByBoth ? "OFFICIAL" : "PENDING",
  };
  return { isAllowed: true, nextState, eventAction: side === "WHITE" ? "CONFIRM_WHITE" : "CONFIRM_BLACK", reason: null };
}

/**
 * SRS-SM-03: a rejection by either undecided side moves the result to DISPUTED, which is never published.
 */
function evaluateReject(transitionRequest: TransitionRequest, side: PlayerSide): TransitionOutcome {
  const { currentState, game, now } = transitionRequest;
  const sideRefusal = findSideDecisionRefusal(currentState, game, side);
  if (sideRefusal) {
    return { isAllowed: false, refusal: sideRefusal };
  }
  const nextState: ResultState = { ...currentState, status: "DISPUTED", disputedBySide: side, disputedAt: now };
  return { isAllowed: true, nextState, eventAction: side === "WHITE" ? "REJECT_WHITE" : "REJECT_BLACK", reason: null };
}

/**
 * Shared guard for confirm and reject: the result must be PENDING, the side must exist and be undecided.
 *
 * @returns The refusal, or null when the side may decide.
 */
function findSideDecisionRefusal(currentState: ResultState, game: GameFacts, side: PlayerSide): TransitionRefusal | null {
  if (currentState.status !== "PENDING") {
    return "INVALID_TRANSITION";
  }
  if (side === "BLACK" && game.isBye) {
    return "SIDE_NOT_PRESENT";
  }
  const sideConfirmedAt = side === "WHITE" ? currentState.whiteConfirmedAt : currentState.blackConfirmedAt;
  // SRS-CONF-05: each side's tap is recorded once.
  return sideConfirmedAt === null ? null : "SIDE_ALREADY_DECIDED";
}

/**
 * SRS-SM-05: the TD approves a PENDING or DISPUTED result as an exception, optionally with a different code.
 * Confirmations already given are kept for the record; actor and reason are logged.
 */
function evaluateApprove(
  transitionRequest: TransitionRequest,
  resultCode: ResultCodeFacts | null,
  reason: string,
): TransitionOutcome {
  const { currentState, actor, game } = transitionRequest;
  const technicalRefusal = findTechnicalActionRefusal(actor, reason);
  if (technicalRefusal) {
    return { isAllowed: false, refusal: technicalRefusal };
  }
  if (!APPROVABLE_STATUSES.has(currentState.status)) {
    return { isAllowed: false, refusal: "INVALID_TRANSITION" };
  }
  // A replacement code must fit the game: a bye cannot take a code that needs two players.
  if (resultCode && !isResultCodeValidForGame(resultCode, game)) {
    return { isAllowed: false, refusal: "RESULT_CODE_NOT_ALLOWED" };
  }
  const nextState: ResultState = {
    ...currentState,
    status: "OFFICIAL",
    resultCodeId: resultCode ? resultCode.id : currentState.resultCodeId,
    approvedByUserId: actor.userId,
    approvalReason: reason.trim(),
  };
  return { isAllowed: true, nextState, eventAction: "APPROVE_EXCEPTION", reason: reason.trim() };
}

/**
 * SRS-SM-06: the TD reopens an OFFICIAL result for correction. The previous code stays visible as context;
 * confirmations and approval are cleared because the next submit must be confirmed again (RULE-09).
 */
function evaluateReopen(transitionRequest: TransitionRequest, reason: string): TransitionOutcome {
  const { currentState, actor } = transitionRequest;
  const technicalRefusal = findTechnicalActionRefusal(actor, reason);
  if (technicalRefusal) {
    return { isAllowed: false, refusal: technicalRefusal };
  }
  if (currentState.status !== "OFFICIAL") {
    return { isAllowed: false, refusal: "INVALID_TRANSITION" };
  }
  const nextState: ResultState = {
    ...EMPTY_RESULT_STATE,
    status: "REOPENED",
    resultCodeId: currentState.resultCodeId,
    enteredByUserId: currentState.enteredByUserId,
  };
  return { isAllowed: true, nextState, eventAction: "REOPEN", reason: reason.trim() };
}

/**
 * SRS-SM-07: the TD changes the code from any state except NONE; the result returns to PENDING with
 * confirmations cleared and needs reconfirmation or an exception approval (RULE-09).
 */
function evaluateEdit(transitionRequest: TransitionRequest, resultCode: ResultCodeFacts, reason: string): TransitionOutcome {
  const { currentState, actor, game } = transitionRequest;
  const technicalRefusal = findTechnicalActionRefusal(actor, reason);
  if (technicalRefusal) {
    return { isAllowed: false, refusal: technicalRefusal };
  }
  if (currentState.status === "NONE") {
    return { isAllowed: false, refusal: "INVALID_TRANSITION" };
  }
  if (!isResultCodeValidForGame(resultCode, game)) {
    return { isAllowed: false, refusal: "RESULT_CODE_NOT_ALLOWED" };
  }
  const nextState: ResultState = {
    ...EMPTY_RESULT_STATE,
    status: "PENDING",
    resultCodeId: resultCode.id,
    enteredByUserId: actor.userId,
  };
  return { isAllowed: true, nextState, eventAction: "EDIT_RESULT", reason: reason.trim() };
}

/**
 * SRS-SM-08: the TD cancels a result from any state except NONE, back to NONE with everything cleared.
 */
function evaluateCancel(transitionRequest: TransitionRequest, reason: string): TransitionOutcome {
  const { currentState, actor } = transitionRequest;
  const technicalRefusal = findTechnicalActionRefusal(actor, reason);
  if (technicalRefusal) {
    return { isAllowed: false, refusal: technicalRefusal };
  }
  if (currentState.status === "NONE") {
    return { isAllowed: false, refusal: "INVALID_TRANSITION" };
  }
  return { isAllowed: true, nextState: { ...EMPTY_RESULT_STATE }, eventAction: "CANCEL", reason: reason.trim() };
}

/**
 * Shared guard for TD-only actions: role first (403 beats 400), then the reason length.
 *
 * @returns The refusal, or null when allowed.
 */
function findTechnicalActionRefusal(actor: TransitionActor, reason: string): TransitionRefusal | null {
  if (actor.role !== "TECHNICAL") {
    return "ROLE_NOT_ALLOWED";
  }
  return isReasonLongEnough(reason) ? null : "REASON_TOO_SHORT";
}

/**
 * The side whose confirmation the flow should ask for next (SRS-CONF-09: resume at the first unconfirmed side).
 *
 * @param resultState - Current result.
 * @param game - Game facts.
 * @returns "WHITE" or "BLACK" while PENDING with an undecided side, otherwise null.
 */
export function findNextSideToConfirm(resultState: ResultState, game: GameFacts): PlayerSide | null {
  if (resultState.status !== "PENDING") {
    return null;
  }
  if (resultState.whiteConfirmedAt === null) {
    return "WHITE";
  }
  if (resultState.blackConfirmedAt === null && !game.isBye) {
    return "BLACK";
  }
  return null;
}

/**
 * Whether the result is OFFICIAL because both players confirmed it, as opposed to a TD approval or a code that
 * skips confirmation. Byes and forfeits must never be shown as "confirmed by both players" (SRS-SM-04).
 *
 * @param resultState - Current result.
 * @returns true only for OFFICIAL results with two confirmations and no exception approval.
 */
export function isOfficialByDoubleConfirmation(resultState: ResultState): boolean {
  return (
    resultState.status === "OFFICIAL" &&
    resultState.whiteConfirmedAt !== null &&
    resultState.blackConfirmedAt !== null &&
    resultState.approvedByUserId === null
  );
}
