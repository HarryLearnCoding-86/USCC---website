// tests/integration/services/tournament-setup-services.test.ts
// Integration tests for tournament creation/update (SRS-TOUR-01, 04, 06), result-code rules (SRS-TOUR-07),
// manual pairing entry (SRS-IMP-06, 08, 13), round search (SRS-LOOK-02) and the console queue (SRS-TD-02).

import { beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "@/server/database/prisma-client";
import { ApiError } from "@/server/http/api-error";
import { getConsoleOverview, listRoundGames } from "@/server/services/game-query-service";
import { deleteManualBoard, saveManualBoard } from "@/server/services/manual-pairing-service";
import { deleteResultCode, updateResultCode } from "@/server/services/result-code-service";
import { applyResultTransition } from "@/server/services/result-lifecycle-service";
import { updateTournament } from "@/server/services/tournament-service";
import { createFixtureUser, wipeTestDatabase } from "../../helpers/test-database";
import { createTournamentFixture, type TournamentFixture } from "../../helpers/tournament-fixtures";

/**
 * Asserts an ApiError with status and code.
 *
 * @param operation - Promise expected to reject.
 * @param httpStatus - Expected status.
 * @param code - Expected code.
 */
async function expectApiError(operation: Promise<unknown>, httpStatus: number, code: string) {
  const error = await operation.catch((caughtError: unknown) => caughtError);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ httpStatus, code });
}

describe("tournament setup services", () => {
  let fixture: TournamentFixture;
  let recorderUser: { id: string; username: string; role: Role };

  beforeEach(async () => {
    await wipeTestDatabase();
    recorderUser = await createFixtureUser("recorder_setup", "RECORDER");
    fixture = await createTournamentFixture();
  });

  const side = (swissManagerPlayerId: string | null, fullName: string) => ({ swissManagerPlayerId, fullName, clubOrFederation: null, pointsBefore: null });
  const roundOne = () => ({ tournamentId: fixture.tournamentId, roundNumber: 1, originalBoardNumber: null });

  it("creates rounds 1..n and the nine default result codes (SRS-TOUR-06)", async () => {
    expect(await prisma.round.count({ where: { tournamentId: fixture.tournamentId } })).toBe(2);
    expect(Object.keys(fixture.resultCodeIdByCode)).toHaveLength(9);
  });

  it("grows the round list and refuses to drop a round that has games", async () => {
    const baseInput = {
      name: "Giải kiểm thử",
      startDate: new Date("2026-11-01T00:00:00Z"),
      endDate: new Date("2026-11-02T00:00:00Z"),
      venue: null,
      organizer: null,
      timezone: "Asia/Ho_Chi_Minh",
      primaryColor: null,
      secondaryColor: null,
    };
    await prisma.$transaction((transaction) => updateTournament(fixture.tournamentId, { ...baseInput, roundsCount: 4 }, transaction));
    expect(await prisma.round.count({ where: { tournamentId: fixture.tournamentId } })).toBe(4);
    await prisma.$transaction((transaction) => updateTournament(fixture.tournamentId, { ...baseInput, roundsCount: 1 }, transaction));
    expect(await prisma.round.count({ where: { tournamentId: fixture.tournamentId } })).toBe(1);
    await prisma.$transaction((transaction) => saveManualBoard({ ...roundOne(), roundNumber: 1 }, { boardNumber: 3, white: side(null, "Người Thứ Ba"), black: null }, transaction));
    // Round 1 has games; shrinking to 0 is blocked by validation, so check the guard with a fresh round 2 game.
    await prisma.$transaction((transaction) => updateTournament(fixture.tournamentId, { ...baseInput, roundsCount: 2 }, transaction));
    await prisma.$transaction((transaction) =>
      saveManualBoard({ tournamentId: fixture.tournamentId, roundNumber: 2, originalBoardNumber: null }, { boardNumber: 1, white: side("9001", "Kỳ Thủ Trắng"), black: null }, transaction),
    );
    await expectApiError(prisma.$transaction((transaction) => updateTournament(fixture.tournamentId, { ...baseInput, roundsCount: 1 }, transaction)), 409, "ROUNDS_HAVE_GAMES");
  });

  it("protects a used result code: no meaning change, no delete, but hide and relabel are allowed (SRS-TOUR-07)", async () => {
    const whiteWinCodeId = fixture.resultCodeIdByCode["1-0"] as string;
    await prisma.$transaction((transaction) =>
      applyResultTransition({ gameId: fixture.twoPlayerGame.gameId, expectedVersion: 0, actionRequest: { type: "SUBMIT_RESULT", resultCodeId: whiteWinCodeId }, actor: recorderUser }, transaction),
    );
    await expectApiError(prisma.$transaction((transaction) => updateResultCode(fixture.tournamentId, whiteWinCodeId, { whiteScore: 0.5 }, transaction)), 409, "RESULT_CODE_IN_USE");
    await expectApiError(prisma.$transaction((transaction) => deleteResultCode(fixture.tournamentId, whiteWinCodeId, transaction)), 409, "RESULT_CODE_IN_USE");
    const relabelled = await prisma.$transaction((transaction) => updateResultCode(fixture.tournamentId, whiteWinCodeId, { labelVi: "Trắng thắng (đã đổi)", isActive: false }, transaction));
    expect(relabelled).toMatchObject({ labelVi: "Trắng thắng (đã đổi)", isActive: false, whiteScore: 1 });
    // An unused code can be deleted.
    await prisma.$transaction((transaction) => deleteResultCode(fixture.tournamentId, fixture.resultCodeIdByCode["BYE0"] as string, transaction));
  });

  it("rejects duplicate boards, players on two boards, ID/name conflicts and ambiguous names (SRS-IMP-06, 08)", async () => {
    const save = (boardNumber: number, white: ReturnType<typeof side>, black: ReturnType<typeof side> | null) =>
      prisma.$transaction((transaction) => saveManualBoard(roundOne(), { boardNumber, white, black }, transaction));
    await expectApiError(save(1, side(null, "Ai Đó"), null), 409, "DUPLICATE_BOARD");
    await expectApiError(save(5, side("9001", "Kỳ Thủ Trắng"), null), 400, "PAIRING_INVALID");
    await expectApiError(save(5, side("9001", "Tên Khác"), null), 400, "PAIRING_INVALID");
    // Two players named the same without IDs → ambiguous, never merged.
    await save(5, side("7001", "Trùng Tên"), side("7002", "Trùng Tên"));
    const error = await save(6, side(null, "Trùng Tên"), null).catch((caughtError: unknown) => caughtError);
    expect(error).toMatchObject({ httpStatus: 400, code: "PAIRING_INVALID", details: [{ code: "AMBIGUOUS_PLAYER_NAME", matchCount: 2 }] });
  });

  it("refuses to edit or delete a board whose result is not NONE, and to delete one with history", async () => {
    const gameId = fixture.twoPlayerGame.gameId;
    await prisma.$transaction((transaction) =>
      applyResultTransition({ gameId, expectedVersion: 0, actionRequest: { type: "SUBMIT_RESULT", resultCodeId: fixture.resultCodeIdByCode["1-0"] as string }, actor: recorderUser }, transaction),
    );
    const editTarget = { tournamentId: fixture.tournamentId, roundNumber: 1, originalBoardNumber: 1 };
    await expectApiError(
      prisma.$transaction((transaction) => saveManualBoard(editTarget, { boardNumber: 1, white: side("9001", "Kỳ Thủ Trắng"), black: null }, transaction)),
      409,
      "GAME_HAS_RESULT",
    );
    await expectApiError(prisma.$transaction((transaction) => deleteManualBoard(editTarget, transaction)), 409, "GAME_HAS_RESULT");
    // A board that never had a result can be deleted.
    await prisma.$transaction((transaction) => deleteManualBoard({ ...editTarget, originalBoardNumber: 2 }, transaction));
    expect((await listRoundGames(fixture.tournamentId, 1)).map((game) => game.boardNumber)).toEqual([1]);
  });

  it("searches by board, ID and diacritic-free name, and filters by status (SRS-LOOK-02, 03)", async () => {
    expect((await listRoundGames(fixture.tournamentId, 1, { search: "ky thu mien" })).map((game) => game.boardNumber)).toEqual([2]);
    expect((await listRoundGames(fixture.tournamentId, 1, { search: "9002" })).map((game) => game.boardNumber)).toEqual([1]);
    expect((await listRoundGames(fixture.tournamentId, 1, { search: "2" })).map((game) => game.boardNumber)).toEqual([2]);
    expect(await listRoundGames(fixture.tournamentId, 1, { search: "", status: "OFFICIAL" })).toEqual([]);
  });

  it("lists disputes oldest first with the rejecting side (SRS-TD-02)", async () => {
    const submitAndReject = async (gameId: string, side: "WHITE" | "BLACK") => {
      await prisma.$transaction((transaction) =>
        applyResultTransition({ gameId, expectedVersion: 0, actionRequest: { type: "SUBMIT_RESULT", resultCodeId: fixture.resultCodeIdByCode["1-0"] as string }, actor: recorderUser }, transaction),
      );
      await prisma.$transaction((transaction) => applyResultTransition({ gameId, expectedVersion: 1, actionRequest: { type: "REJECT_BY_SIDE", side }, actor: recorderUser }, transaction));
    };
    const laterGame = await prisma.$transaction((transaction) =>
      saveManualBoard(roundOne(), { boardNumber: 3, white: side("8001", "Người Ba"), black: side("8002", "Người Bốn") }, transaction),
    );
    await submitAndReject(fixture.twoPlayerGame.gameId, "BLACK");
    await submitAndReject(laterGame.gameId, "WHITE");
    const overview = await getConsoleOverview(fixture.tournamentId, 1);
    expect(overview.disputedQueue.map((game) => [game.boardNumber, game.result.disputedBySide])).toEqual([
      [1, "BLACK"],
      [3, "WHITE"],
    ]);
    expect(overview.statusCounts).toMatchObject({ DISPUTED: 2, NONE: 1 });
  });
});
