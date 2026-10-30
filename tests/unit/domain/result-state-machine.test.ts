// tests/unit/domain/result-state-machine.test.ts
// Exhaustive tests of the result state machine (AGENT_PROMPT.md §3.3, SRS §7): every action from every status
// for both roles is checked against an expected table written from the SRS, plus the guards on sides,
// reasons, byes and codes without player confirmation.

import type { ResultStatus, Role } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  EMPTY_RESULT_STATE,
  evaluateResultTransition,
  findNextSideToConfirm,
  isOfficialByDoubleConfirmation,
  type ResultAction,
  type ResultCodeFacts,
  type ResultState,
  type TransitionOutcome,
} from "@/server/domain/result-state-machine";

const NOW = new Date("2026-10-30T10:00:00Z");
const EARLIER = new Date("2026-10-30T09:59:00Z");
const TWO_PLAYER_CODE: ResultCodeFacts = { id: "code-1-0", requiresPlayerConfirmation: true };
const OTHER_TWO_PLAYER_CODE: ResultCodeFacts = { id: "code-draw", requiresPlayerConfirmation: true };
const BYE_CODE: ResultCodeFacts = { id: "code-bye", requiresPlayerConfirmation: false };
const VALID_REASON = "Trọng tài đã kiểm tra biên bản";
const TECHNICAL = { userId: "td-1", role: "TECHNICAL" as Role };
const RECORDER = { userId: "rec-1", role: "RECORDER" as Role };
const TWO_PLAYER_GAME = { isBye: false };
const BYE_GAME = { isBye: true };

/** A representative state for each status, as the system would actually hold it. */
const STATE_BY_STATUS: Record<ResultStatus, ResultState> = {
  NONE: EMPTY_RESULT_STATE,
  PENDING: { ...EMPTY_RESULT_STATE, status: "PENDING", resultCodeId: TWO_PLAYER_CODE.id, enteredByUserId: "rec-1" },
  DISPUTED: {
    ...EMPTY_RESULT_STATE,
    status: "DISPUTED",
    resultCodeId: TWO_PLAYER_CODE.id,
    enteredByUserId: "rec-1",
    whiteConfirmedAt: EARLIER,
    disputedBySide: "BLACK",
    disputedAt: EARLIER,
  },
  OFFICIAL: {
    ...EMPTY_RESULT_STATE,
    status: "OFFICIAL",
    resultCodeId: TWO_PLAYER_CODE.id,
    enteredByUserId: "rec-1",
    whiteConfirmedAt: EARLIER,
    blackConfirmedAt: EARLIER,
  },
  REOPENED: { ...EMPTY_RESULT_STATE, status: "REOPENED", resultCodeId: TWO_PLAYER_CODE.id, enteredByUserId: "rec-1" },
};

const ALL_STATUSES = Object.keys(STATE_BY_STATUS) as ResultStatus[];

/** The seven actions with valid arguments, so only status and role decide the outcome. */
const ACTIONS: Record<string, ResultAction> = {
  submit: { type: "SUBMIT_RESULT", resultCode: TWO_PLAYER_CODE },
  confirmWhite: { type: "CONFIRM_BY_SIDE", side: "WHITE" },
  rejectWhite: { type: "REJECT_BY_SIDE", side: "WHITE" },
  approve: { type: "APPROVE_EXCEPTION", resultCode: null, reason: VALID_REASON },
  reopen: { type: "REOPEN", reason: VALID_REASON },
  edit: { type: "EDIT_RESULT", resultCode: OTHER_TWO_PLAYER_CODE, reason: VALID_REASON },
  cancel: { type: "CANCEL", reason: VALID_REASON },
};

type ExpectedOutcome = ResultStatus | "INVALID_TRANSITION" | "ROLE_NOT_ALLOWED" | "SIDE_ALREADY_DECIDED";

/**
 * Expected outcome for a TECHNICAL actor, from SRS §7 (SRS-SM-01 … SRS-SM-08).
 * Rows: action. Columns: current status. A status value means "allowed, moves to that status".
 */
const EXPECTED_FOR_TECHNICAL: Record<string, Record<ResultStatus, ExpectedOutcome>> = {
  submit: { NONE: "PENDING", PENDING: "INVALID_TRANSITION", DISPUTED: "INVALID_TRANSITION", OFFICIAL: "INVALID_TRANSITION", REOPENED: "PENDING" },
  confirmWhite: { NONE: "INVALID_TRANSITION", PENDING: "PENDING", DISPUTED: "INVALID_TRANSITION", OFFICIAL: "INVALID_TRANSITION", REOPENED: "INVALID_TRANSITION" },
  rejectWhite: { NONE: "INVALID_TRANSITION", PENDING: "DISPUTED", DISPUTED: "INVALID_TRANSITION", OFFICIAL: "INVALID_TRANSITION", REOPENED: "INVALID_TRANSITION" },
  approve: { NONE: "INVALID_TRANSITION", PENDING: "OFFICIAL", DISPUTED: "OFFICIAL", OFFICIAL: "INVALID_TRANSITION", REOPENED: "INVALID_TRANSITION" },
  reopen: { NONE: "INVALID_TRANSITION", PENDING: "INVALID_TRANSITION", DISPUTED: "INVALID_TRANSITION", OFFICIAL: "REOPENED", REOPENED: "INVALID_TRANSITION" },
  edit: { NONE: "INVALID_TRANSITION", PENDING: "PENDING", DISPUTED: "PENDING", OFFICIAL: "PENDING", REOPENED: "PENDING" },
  cancel: { NONE: "INVALID_TRANSITION", PENDING: "NONE", DISPUTED: "NONE", OFFICIAL: "NONE", REOPENED: "NONE" },
};

/** RECORDER: same as TECHNICAL for submit / confirm / reject; every TD-only action is refused by role. */
const EXPECTED_FOR_RECORDER: Record<string, Record<ResultStatus, ExpectedOutcome>> = {
  ...EXPECTED_FOR_TECHNICAL,
  approve: Object.fromEntries(ALL_STATUSES.map((status) => [status, "ROLE_NOT_ALLOWED"])) as Record<ResultStatus, ExpectedOutcome>,
  reopen: Object.fromEntries(ALL_STATUSES.map((status) => [status, "ROLE_NOT_ALLOWED"])) as Record<ResultStatus, ExpectedOutcome>,
  edit: Object.fromEntries(ALL_STATUSES.map((status) => [status, "ROLE_NOT_ALLOWED"])) as Record<ResultStatus, ExpectedOutcome>,
  cancel: Object.fromEntries(ALL_STATUSES.map((status) => [status, "ROLE_NOT_ALLOWED"])) as Record<ResultStatus, ExpectedOutcome>,
};

/**
 * Reduces an outcome to the comparable expected value.
 *
 * @param outcome - State machine outcome.
 * @returns The next status when allowed, otherwise the refusal code.
 */
function summarizeOutcome(outcome: TransitionOutcome): string {
  return outcome.isAllowed ? outcome.nextState.status : outcome.refusal;
}

describe("transition table (SRS §7), every action × status × role", () => {
  const cases = (["TECHNICAL", "RECORDER"] as const).flatMap((roleName) =>
    Object.keys(ACTIONS).flatMap((actionName) =>
      ALL_STATUSES.map((status) => {
        const expectedTable = roleName === "TECHNICAL" ? EXPECTED_FOR_TECHNICAL : EXPECTED_FOR_RECORDER;
        return { roleName, actionName, status, expected: expectedTable[actionName]?.[status] };
      }),
    ),
  );

  it.each(cases)("$roleName $actionName from $status → $expected", ({ roleName, actionName, status, expected }) => {
    const outcome = evaluateResultTransition({
      currentState: STATE_BY_STATUS[status],
      action: ACTIONS[actionName] as ResultAction,
      actor: roleName === "TECHNICAL" ? TECHNICAL : RECORDER,
      game: TWO_PLAYER_GAME,
      now: NOW,
    });
    expect(summarizeOutcome(outcome)).toBe(expected);
  });
});

describe("submitResult (SRS-SM-01, SRS-SM-04)", () => {
  it("clears confirmations, dispute and approval and records who entered it", () => {
    const outcome = evaluateResultTransition({
      currentState: { ...STATE_BY_STATUS.REOPENED, whiteConfirmedAt: EARLIER, approvedByUserId: "td-0", approvalReason: "old" },
      action: ACTIONS.submit as ResultAction,
      actor: RECORDER,
      game: TWO_PLAYER_GAME,
      now: NOW,
    });
    expect(outcome).toMatchObject({
      isAllowed: true,
      eventAction: "SUBMIT_RESULT",
      nextState: { status: "PENDING", whiteConfirmedAt: null, blackConfirmedAt: null, approvedByUserId: null, approvalReason: null, enteredByUserId: "rec-1" },
    });
  });

  it("sends a TD's bye straight to OFFICIAL without marking any player confirmation", () => {
    const outcome = evaluateResultTransition({
      currentState: EMPTY_RESULT_STATE,
      action: { type: "SUBMIT_RESULT", resultCode: BYE_CODE },
      actor: TECHNICAL,
      game: BYE_GAME,
      now: NOW,
    });
    expect(outcome.isAllowed && outcome.nextState).toMatchObject({ status: "OFFICIAL", whiteConfirmedAt: null, blackConfirmedAt: null });
    expect(outcome.isAllowed && isOfficialByDoubleConfirmation(outcome.nextState)).toBe(false);
  });

  it("refuses a code without player confirmation from a RECORDER (TD only)", () => {
    const outcome = evaluateResultTransition({
      currentState: EMPTY_RESULT_STATE,
      action: { type: "SUBMIT_RESULT", resultCode: BYE_CODE },
      actor: RECORDER,
      game: BYE_GAME,
      now: NOW,
    });
    expect(summarizeOutcome(outcome)).toBe("ROLE_NOT_ALLOWED");
  });

  it("refuses a two-player code on a bye game", () => {
    const outcome = evaluateResultTransition({
      currentState: EMPTY_RESULT_STATE,
      action: ACTIONS.submit as ResultAction,
      actor: TECHNICAL,
      game: BYE_GAME,
      now: NOW,
    });
    expect(summarizeOutcome(outcome)).toBe("RESULT_CODE_NOT_ALLOWED");
  });
});

describe("confirmation flow (SRS-SM-02, SRS-SM-03, SRS-CONF-05..07)", () => {
  /**
   * Applies an action as the recorder on a two-player game.
   *
   * @param currentState - Starting state.
   * @param action - Action to apply.
   * @returns The outcome.
   */
  function applyAsRecorder(currentState: ResultState, action: ResultAction): TransitionOutcome {
    return evaluateResultTransition({ currentState, action, actor: RECORDER, game: TWO_PLAYER_GAME, now: NOW });
  }

  it("stays PENDING after White confirms, becomes OFFICIAL after Black confirms (FR-06)", () => {
    const afterWhite = applyAsRecorder(STATE_BY_STATUS.PENDING, { type: "CONFIRM_BY_SIDE", side: "WHITE" });
    expect(afterWhite.isAllowed && afterWhite.nextState).toMatchObject({ status: "PENDING", whiteConfirmedAt: NOW, blackConfirmedAt: null });
    if (!afterWhite.isAllowed) throw new Error("white confirmation refused");

    const afterBlack = applyAsRecorder(afterWhite.nextState, { type: "CONFIRM_BY_SIDE", side: "BLACK" });
    expect(afterBlack).toMatchObject({ isAllowed: true, eventAction: "CONFIRM_BLACK", nextState: { status: "OFFICIAL" } });
    expect(afterBlack.isAllowed && isOfficialByDoubleConfirmation(afterBlack.nextState)).toBe(true);
  });

  it("allows Black to confirm first; order does not matter", () => {
    const afterBlack = applyAsRecorder(STATE_BY_STATUS.PENDING, { type: "CONFIRM_BY_SIDE", side: "BLACK" });
    expect(summarizeOutcome(afterBlack)).toBe("PENDING");
  });

  it("refuses a second tap by the same side (SRS-CONF-05)", () => {
    const whiteConfirmed = { ...STATE_BY_STATUS.PENDING, whiteConfirmedAt: EARLIER };
    expect(summarizeOutcome(applyAsRecorder(whiteConfirmed, { type: "CONFIRM_BY_SIDE", side: "WHITE" }))).toBe("SIDE_ALREADY_DECIDED");
    expect(summarizeOutcome(applyAsRecorder(whiteConfirmed, { type: "REJECT_BY_SIDE", side: "WHITE" }))).toBe("SIDE_ALREADY_DECIDED");
  });

  it("records which side rejected and when (SRS-TD-02)", () => {
    const outcome = applyAsRecorder({ ...STATE_BY_STATUS.PENDING, whiteConfirmedAt: EARLIER }, { type: "REJECT_BY_SIDE", side: "BLACK" });
    expect(outcome).toMatchObject({ isAllowed: true, eventAction: "REJECT_BLACK", nextState: { status: "DISPUTED", disputedBySide: "BLACK", disputedAt: NOW } });
  });

  it("refuses Black's decision on a bye game", () => {
    const outcome = evaluateResultTransition({
      currentState: STATE_BY_STATUS.PENDING,
      action: { type: "CONFIRM_BY_SIDE", side: "BLACK" },
      actor: TECHNICAL,
      game: BYE_GAME,
      now: NOW,
    });
    expect(summarizeOutcome(outcome)).toBe("SIDE_NOT_PRESENT");
  });
});

describe("TD actions (SRS-SM-05..08)", () => {
  it.each(["approve", "reopen", "edit", "cancel"])("%s refuses a reason shorter than 5 characters", (actionName) => {
    const startingStatus: ResultStatus = actionName === "reopen" ? "OFFICIAL" : "DISPUTED";
    const actionWithShortReason = { ...(ACTIONS[actionName] as ResultAction), reason: "  ok  " } as ResultAction;
    const outcome = evaluateResultTransition({
      currentState: STATE_BY_STATUS[startingStatus],
      action: actionWithShortReason,
      actor: TECHNICAL,
      game: TWO_PLAYER_GAME,
      now: NOW,
    });
    expect(summarizeOutcome(outcome)).toBe("REASON_TOO_SHORT");
  });

  it("approve keeps existing confirmations, records the approver and the trimmed reason, optionally replacing the code", () => {
    const outcome = evaluateResultTransition({
      currentState: STATE_BY_STATUS.DISPUTED,
      action: { type: "APPROVE_EXCEPTION", resultCode: OTHER_TWO_PLAYER_CODE, reason: `  ${VALID_REASON}  ` },
      actor: TECHNICAL,
      game: TWO_PLAYER_GAME,
      now: NOW,
    });
    expect(outcome).toMatchObject({
      isAllowed: true,
      reason: VALID_REASON,
      nextState: { status: "OFFICIAL", resultCodeId: OTHER_TWO_PLAYER_CODE.id, approvedByUserId: "td-1", approvalReason: VALID_REASON, whiteConfirmedAt: EARLIER },
    });
    expect(outcome.isAllowed && isOfficialByDoubleConfirmation(outcome.nextState)).toBe(false);
  });

  it("reopen clears confirmations but keeps the previous code for context", () => {
    const outcome = evaluateResultTransition({
      currentState: STATE_BY_STATUS.OFFICIAL,
      action: ACTIONS.reopen as ResultAction,
      actor: TECHNICAL,
      game: TWO_PLAYER_GAME,
      now: NOW,
    });
    expect(outcome.isAllowed && outcome.nextState).toMatchObject({ status: "REOPENED", resultCodeId: TWO_PLAYER_CODE.id, whiteConfirmedAt: null, blackConfirmedAt: null });
  });

  it("edit sets the new code and clears confirmations (RULE-09)", () => {
    const outcome = evaluateResultTransition({
      currentState: STATE_BY_STATUS.OFFICIAL,
      action: ACTIONS.edit as ResultAction,
      actor: TECHNICAL,
      game: TWO_PLAYER_GAME,
      now: NOW,
    });
    expect(outcome.isAllowed && outcome.nextState).toMatchObject({ status: "PENDING", resultCodeId: OTHER_TWO_PLAYER_CODE.id, whiteConfirmedAt: null, blackConfirmedAt: null, enteredByUserId: "td-1" });
  });

  it("cancel resets everything to an empty result", () => {
    const outcome = evaluateResultTransition({
      currentState: STATE_BY_STATUS.DISPUTED,
      action: ACTIONS.cancel as ResultAction,
      actor: TECHNICAL,
      game: TWO_PLAYER_GAME,
      now: NOW,
    });
    expect(outcome.isAllowed && outcome.nextState).toEqual(EMPTY_RESULT_STATE);
  });

  it("edit and approve refuse a two-player code on a bye game", () => {
    const pendingBye = { ...STATE_BY_STATUS.PENDING, resultCodeId: BYE_CODE.id };
    for (const action of [ACTIONS.edit, { type: "APPROVE_EXCEPTION", resultCode: TWO_PLAYER_CODE, reason: VALID_REASON }] as ResultAction[]) {
      const outcome = evaluateResultTransition({ currentState: pendingBye, action, actor: TECHNICAL, game: BYE_GAME, now: NOW });
      expect(summarizeOutcome(outcome)).toBe("RESULT_CODE_NOT_ALLOWED");
    }
  });
});

describe("findNextSideToConfirm (SRS-CONF-09 resume)", () => {
  it("resumes at White, then Black, then nothing", () => {
    expect(findNextSideToConfirm(STATE_BY_STATUS.PENDING, TWO_PLAYER_GAME)).toBe("WHITE");
    expect(findNextSideToConfirm({ ...STATE_BY_STATUS.PENDING, whiteConfirmedAt: EARLIER }, TWO_PLAYER_GAME)).toBe("BLACK");
    expect(findNextSideToConfirm({ ...STATE_BY_STATUS.PENDING, blackConfirmedAt: EARLIER }, TWO_PLAYER_GAME)).toBe("WHITE");
  });

  it("returns null outside PENDING", () => {
    for (const status of ["NONE", "DISPUTED", "OFFICIAL", "REOPENED"] as const) {
      expect(findNextSideToConfirm(STATE_BY_STATUS[status], TWO_PLAYER_GAME)).toBeNull();
    }
  });
});
