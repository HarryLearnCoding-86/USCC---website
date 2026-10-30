// tests/integration/services/result-lifecycle-service.test.ts
// Integration tests for the result lifecycle against PostgreSQL (SRS-SM-09..11, SRS-AUD-01..03):
// full confirmation flow, dispute → approval, version conflicts, concurrent submits, audit rows,
// byes, hidden codes, and role refusals. Every transition also executes pg_notify (it would throw if broken);
// delivery to a LISTEN client is tested in Phase 3 together with the listener.

import { beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "@/server/database/prisma-client";
import { ApiError } from "@/server/http/api-error";
import { applyResultTransition, type ResultActionRequest } from "@/server/services/result-lifecycle-service";
import { createFixtureUser, wipeTestDatabase } from "../../helpers/test-database";
import { createTournamentFixture, type TournamentFixture } from "../../helpers/tournament-fixtures";

const VALID_REASON = "Đã kiểm tra với hai kỳ thủ";

describe("applyResultTransition", () => {
  let fixture: TournamentFixture;
  let technicalUser: { id: string; username: string; role: Role };
  let recorderUser: { id: string; username: string; role: Role };

  beforeEach(async () => {
    await wipeTestDatabase();
    technicalUser = await createFixtureUser("td_lifecycle", "TECHNICAL");
    recorderUser = await createFixtureUser("recorder_lifecycle", "RECORDER");
    fixture = await createTournamentFixture();
  });

  /**
   * Runs one action in its own transaction, as the route wrapper does.
   *
   * @param gameId - Game to act on.
   * @param expectedVersion - Version the client saw.
   * @param actionRequest - Action.
   * @param actor - Acting user.
   * @returns The updated game view.
   */
  function act(gameId: string, expectedVersion: number, actionRequest: ResultActionRequest, actor = recorderUser) {
    return prisma.$transaction((transaction) => applyResultTransition({ gameId, expectedVersion, actionRequest, actor }, transaction));
  }

  /**
   * Asserts an ApiError with status and code.
   *
   * @param operation - Promise expected to reject.
   * @param httpStatus - Expected HTTP status.
   * @param code - Expected error code.
   */
  async function expectApiError(operation: Promise<unknown>, httpStatus: number, code: string) {
    const error = await operation.catch((caughtError: unknown) => caughtError);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ httpStatus, code });
  }

  it("runs submit → White confirms → Black confirms → OFFICIAL with one audit row per step (FR-06)", async () => {
    const gameId = fixture.twoPlayerGame.gameId;
    const afterSubmit = await act(gameId, 0, { type: "SUBMIT_RESULT", resultCodeId: fixture.resultCodeIdByCode["1-0"] as string });
    expect(afterSubmit.result).toMatchObject({ status: "PENDING", version: 1, enteredByUsername: "recorder_lifecycle" });

    const afterWhite = await act(gameId, 1, { type: "CONFIRM_BY_SIDE", side: "WHITE" });
    expect(afterWhite.result.status).toBe("PENDING");
    const afterBlack = await act(gameId, 2, { type: "CONFIRM_BY_SIDE", side: "BLACK" });
    expect(afterBlack.result).toMatchObject({ status: "OFFICIAL", version: 3, isOfficialByDoubleConfirmation: true });

    const resultEvents = await prisma.resultEvent.findMany({ orderBy: { createdAt: "asc" } });
    expect(resultEvents.map((resultEvent) => resultEvent.action)).toEqual(["SUBMIT_RESULT", "CONFIRM_WHITE", "CONFIRM_BLACK"]);
    // SRS-CONF-10: the recorder account holding the phone is logged for each confirmation.
    expect(resultEvents.every((resultEvent) => resultEvent.actorUserId === recorderUser.id)).toBe(true);
    expect(resultEvents[2]?.oldValue).toMatchObject({ status: "PENDING", version: 2, resultCode: "1-0" });
    expect(resultEvents[2]?.newValue).toMatchObject({ status: "OFFICIAL", version: 3 });
  });

  it("runs reject → DISPUTED → TD approves with a logged reason (SRS-SM-03, SRS-SM-05)", async () => {
    const gameId = fixture.twoPlayerGame.gameId;
    await act(gameId, 0, { type: "SUBMIT_RESULT", resultCodeId: fixture.resultCodeIdByCode["1-0"] as string });
    const afterReject = await act(gameId, 1, { type: "REJECT_BY_SIDE", side: "BLACK" });
    expect(afterReject.result).toMatchObject({ status: "DISPUTED", disputedBySide: "BLACK" });

    await expectApiError(act(gameId, 2, { type: "APPROVE_EXCEPTION", resultCodeId: null, reason: VALID_REASON }), 403, "ROLE_NOT_ALLOWED");
    await expectApiError(act(gameId, 2, { type: "APPROVE_EXCEPTION", resultCodeId: null, reason: "ok" }, technicalUser), 400, "REASON_TOO_SHORT");

    const afterApprove = await act(gameId, 2, { type: "APPROVE_EXCEPTION", resultCodeId: null, reason: VALID_REASON }, technicalUser);
    expect(afterApprove.result).toMatchObject({
      status: "OFFICIAL",
      approvedByUsername: "td_lifecycle",
      approvalReason: VALID_REASON,
      isOfficialByDoubleConfirmation: false,
    });
    const approvalEvent = await prisma.resultEvent.findFirstOrThrow({ where: { action: "APPROVE_EXCEPTION" } });
    expect(approvalEvent).toMatchObject({ actorUserId: technicalUser.id, reason: VALID_REASON });
  });

  it("rejects a stale version with 409 and the SRS-SM-10 message, changing nothing", async () => {
    const gameId = fixture.twoPlayerGame.gameId;
    await act(gameId, 0, { type: "SUBMIT_RESULT", resultCodeId: fixture.resultCodeIdByCode["1-0"] as string });
    const error = await act(gameId, 0, { type: "CONFIRM_BY_SIDE", side: "WHITE" }).catch((caughtError: unknown) => caughtError);
    expect(error).toMatchObject({ httpStatus: 409, code: "VERSION_CONFLICT", messageVi: "Kết quả đã thay đổi. Vui lòng tải lại." });
    expect(await prisma.resultEvent.count()).toBe(1);
  });

  it("accepts only the first of two simultaneous submits on the same board (RISK-04)", async () => {
    const gameId = fixture.twoPlayerGame.gameId;
    const submit = (code: string) => act(gameId, 0, { type: "SUBMIT_RESULT", resultCodeId: fixture.resultCodeIdByCode[code] as string });
    const outcomes = await Promise.allSettled([submit("1-0"), submit("0-1")]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejectedOutcome = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejectedOutcome && "reason" in rejectedOutcome ? rejectedOutcome.reason : null).toMatchObject({ httpStatus: 409, code: "VERSION_CONFLICT" });
    expect(await prisma.resultEvent.count()).toBe(1);
  });

  it("sends a TD's bye straight to OFFICIAL and refuses it from a recorder (SRS-SM-04)", async () => {
    const byeCodeId = fixture.resultCodeIdByCode.BYE as string;
    await expectApiError(act(fixture.byeGame.gameId, 0, { type: "SUBMIT_RESULT", resultCodeId: byeCodeId }), 403, "ROLE_NOT_ALLOWED");
    const afterSubmit = await act(fixture.byeGame.gameId, 0, { type: "SUBMIT_RESULT", resultCodeId: byeCodeId }, technicalUser);
    expect(afterSubmit.result).toMatchObject({ status: "OFFICIAL", whiteConfirmedAt: null, blackConfirmedAt: null, isOfficialByDoubleConfirmation: false });
  });

  it("refuses a hidden result code (SRS-TOUR-07)", async () => {
    const drawCodeId = fixture.resultCodeIdByCode["½-½"] as string;
    await prisma.resultCode.update({ where: { id: drawCodeId }, data: { isActive: false } });
    await expectApiError(act(fixture.twoPlayerGame.gameId, 0, { type: "SUBMIT_RESULT", resultCodeId: drawCodeId }), 400, "RESULT_CODE_INACTIVE");
  });

  it("supports reopen, edit and cancel by the TD with audit rows", async () => {
    const gameId = fixture.twoPlayerGame.gameId;
    await act(gameId, 0, { type: "SUBMIT_RESULT", resultCodeId: fixture.resultCodeIdByCode["1-0"] as string });
    await act(gameId, 1, { type: "CONFIRM_BY_SIDE", side: "WHITE" });
    await act(gameId, 2, { type: "CONFIRM_BY_SIDE", side: "BLACK" });
    const afterReopen = await act(gameId, 3, { type: "REOPEN", reason: VALID_REASON }, technicalUser);
    expect(afterReopen.result.status).toBe("REOPENED");
    const afterEdit = await act(gameId, 4, { type: "EDIT_RESULT", resultCodeId: fixture.resultCodeIdByCode["0-1"] as string, reason: VALID_REASON }, technicalUser);
    expect(afterEdit.result).toMatchObject({ status: "PENDING", resultCode: { code: "0-1" }, whiteConfirmedAt: null });
    const afterCancel = await act(gameId, 5, { type: "CANCEL", reason: VALID_REASON }, technicalUser);
    expect(afterCancel.result).toMatchObject({ status: "NONE", resultCode: null, version: 6 });
    expect(await prisma.resultEvent.count()).toBe(6);
  });

  it("returns 404 for an unknown game", async () => {
    await expectApiError(act("missing-game", 0, { type: "CONFIRM_BY_SIDE", side: "WHITE" }), 404, "GAME_NOT_FOUND");
  });
});
