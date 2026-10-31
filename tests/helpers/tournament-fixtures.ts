// tests/helpers/tournament-fixtures.ts
// Builds a small tournament through the real services (create tournament → manual boards), so integration
// tests exercise the same paths as the app. Player names are fictional (CLAUDE.md §2).

import { prisma } from "@/server/database/prisma-client";
import { createTournament } from "@/server/services/tournament-service";
import { saveManualBoard } from "@/server/services/manual-pairing-service";
import type { GameView } from "@/server/services/game-view-mapper";

/** IDs a test needs after building the fixture. */
export interface TournamentFixture {
  tournamentId: string;
  twoPlayerGame: GameView;
  byeGame: GameView;
  resultCodeIdByCode: Record<string, string>;
}

/**
 * Creates a 2-round tournament with board 1 (two players) and board 2 (a bye) in round 1.
 *
 * @returns IDs of the tournament, both games and every result code.
 */
export async function createTournamentFixture(): Promise<TournamentFixture> {
  const tournament = await prisma.$transaction((transaction) =>
    createTournament(
      {
        name: "Giải kiểm thử",
        startDate: new Date("2026-11-01T00:00:00Z"),
        endDate: new Date("2026-11-02T00:00:00Z"),
        venue: null,
        organizer: null,
        roundsCount: 2,
        timezone: "Asia/Ho_Chi_Minh",
        primaryColor: null,
        secondaryColor: null,
      },
      transaction,
    ),
  );
  const target = { tournamentId: tournament.id, roundNumber: 1, originalBoardNumber: null };
  const twoPlayerGame = await prisma.$transaction((transaction) =>
    saveManualBoard(
      target,
      {
        boardNumber: 1,
        white: { swissManagerPlayerId: "9001", fullName: "Kỳ Thủ Trắng", clubOrFederation: null, pointsBefore: 0 },
        black: { swissManagerPlayerId: "9002", fullName: "Kỳ Thủ Đen", clubOrFederation: null, pointsBefore: 0 },
      },
      transaction,
    ),
  );
  const byeGame = await prisma.$transaction((transaction) =>
    saveManualBoard(
      target,
      { boardNumber: 2, white: { swissManagerPlayerId: "9003", fullName: "Kỳ Thủ Miễn Đấu", clubOrFederation: null, pointsBefore: 0 }, black: null },
      transaction,
    ),
  );
  const resultCodes = await prisma.resultCode.findMany({ where: { tournamentId: tournament.id } });
  return {
    tournamentId: tournament.id,
    twoPlayerGame,
    byeGame,
    resultCodeIdByCode: Object.fromEntries(resultCodes.map((resultCode) => [resultCode.code, resultCode.id])),
  };
}
