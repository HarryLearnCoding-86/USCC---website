// tests/unit/client/predict-game-after-action.test.ts
// Unit tests for the offline prediction: it must follow the server's state machine exactly, so a recorder can run
// submit → White → Black offline and see the status the server will compute on replay.

import { describe, expect, it } from "vitest";
import { predictGameAfterAction } from "@/client/offline/predict-game-after-action";
import type { GameView, ResultCodeView } from "@/server/services/game-view-mapper";

const WHITE_WIN_CODE: ResultCodeView = {
  id: "code-1-0",
  code: "1-0",
  labelVi: "Trắng thắng",
  whiteScore: 1,
  blackScore: 0,
  requiresPlayerConfirmation: true,
  swissManagerValue: "1-0",
  sortOrder: 1,
  isActive: true,
};
const BYE_CODE: ResultCodeView = { ...WHITE_WIN_CODE, id: "code-bye", code: "BYE", labelVi: "Miễn đấu", requiresPlayerConfirmation: false };
const RECORDER = { username: "recorder_demo", role: "RECORDER" as const };
const NOW = new Date("2026-10-30T09:00:00Z");

const EMPTY_GAME: GameView = {
  gameId: "g1",
  tournamentId: "t1",
  roundNumber: 1,
  boardNumber: 4,
  white: { id: "p1", swissManagerPlayerId: "1", fullName: "Trắng", clubOrFederation: null, pointsBefore: null },
  black: { id: "p2", swissManagerPlayerId: "2", fullName: "Đen", clubOrFederation: null, pointsBefore: null },
  result: {
    status: "NONE",
    version: 0,
    resultCode: null,
    whiteConfirmedAt: null,
    blackConfirmedAt: null,
    disputedBySide: null,
    disputedAt: null,
    enteredByUsername: null,
    approvedByUsername: null,
    approvalReason: null,
    isOfficialByDoubleConfirmation: false,
  },
};

describe("predictGameAfterAction", () => {
  it("predicts submit → White → Black → OFFICIAL with one version per action", () => {
    const afterSubmit = predictGameAfterAction(EMPTY_GAME, { type: "SUBMIT_RESULT", resultCodeId: WHITE_WIN_CODE.id }, [WHITE_WIN_CODE], RECORDER, NOW);
    expect(afterSubmit?.result).toMatchObject({ status: "PENDING", version: 1, resultCode: { code: "1-0" }, enteredByUsername: "recorder_demo" });
    const afterWhite = predictGameAfterAction(afterSubmit as GameView, { type: "CONFIRM_BY_SIDE", side: "WHITE" }, [WHITE_WIN_CODE], RECORDER, NOW);
    expect(afterWhite?.result).toMatchObject({ status: "PENDING", version: 2, whiteConfirmedAt: NOW.toISOString() });
    const afterBlack = predictGameAfterAction(afterWhite as GameView, { type: "CONFIRM_BY_SIDE", side: "BLACK" }, [WHITE_WIN_CODE], RECORDER, NOW);
    expect(afterBlack?.result).toMatchObject({ status: "OFFICIAL", version: 3, isOfficialByDoubleConfirmation: true });
  });

  it("predicts a rejection as DISPUTED with the side", () => {
    const pendingGame = predictGameAfterAction(EMPTY_GAME, { type: "SUBMIT_RESULT", resultCodeId: WHITE_WIN_CODE.id }, [WHITE_WIN_CODE], RECORDER, NOW) as GameView;
    const afterReject = predictGameAfterAction(pendingGame, { type: "REJECT_BY_SIDE", side: "BLACK" }, [WHITE_WIN_CODE], RECORDER, NOW);
    expect(afterReject?.result).toMatchObject({ status: "DISPUTED", disputedBySide: "BLACK" });
  });

  it("returns null for what the server would refuse", () => {
    expect(predictGameAfterAction(EMPTY_GAME, { type: "CONFIRM_BY_SIDE", side: "WHITE" }, [WHITE_WIN_CODE], RECORDER, NOW)).toBeNull();
    expect(predictGameAfterAction(EMPTY_GAME, { type: "SUBMIT_RESULT", resultCodeId: "unknown" }, [WHITE_WIN_CODE], RECORDER, NOW)).toBeNull();
    expect(predictGameAfterAction(EMPTY_GAME, { type: "SUBMIT_RESULT", resultCodeId: BYE_CODE.id }, [BYE_CODE], RECORDER, NOW)).toBeNull();
  });
});
