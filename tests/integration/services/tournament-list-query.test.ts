// tests/integration/services/tournament-list-query.test.ts
// Integration tests for the tournament list against the test database: official win and draw counts (pending
// results and byes not counted), sorting by most wins, search, and 15 tournaments per page.

import { execSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/database/prisma-client";
import { applyResultTransition, type ResultActionRequest } from "@/server/services/result-lifecycle-service";
import { queryTournamentList } from "@/server/services/tournament-query-service";
import { createTournament } from "@/server/services/tournament-service";
import { wipeTestDatabase } from "../../helpers/test-database";
import { getVerifiedTestDatabaseUrl } from "../../helpers/test-database-url";

const DEMO_TOURNAMENT_NAME = "Giải Demo USCC 2026";
/** Extra tournaments so the list spans two pages: 16 + the demo = 17. */
const EXTRA_TOURNAMENT_COUNT = 16;

beforeAll(async () => {
  await wipeTestDatabase();
  execSync("pnpm exec tsx prisma/seed.ts", { env: { ...process.env, DATABASE_URL: getVerifiedTestDatabaseUrl() }, stdio: "pipe" });

  for (let tournamentIndex = 0; tournamentIndex < EXTRA_TOURNAMENT_COUNT; tournamentIndex++) {
    const startDate = new Date(Date.UTC(2025, 0, tournamentIndex + 1));
    await prisma.$transaction((transaction) =>
      createTournament(
        {
          name: `Giải Cờ Nhanh Số ${String(tournamentIndex + 1).padStart(2, "0")}`,
          startDate,
          endDate: startDate,
          venue: tournamentIndex === 0 ? "Nhà văn hóa Thanh Niên" : null,
          organizer: null,
          roundsCount: 1,
          timezone: "Asia/Ho_Chi_Minh",
          primaryColor: null,
          secondaryColor: null,
        },
        transaction,
      ),
    );
  }

  // Demo tournament: board 1 White wins and board 2 is drawn (both OFFICIAL); board 3 stays PENDING.
  const demoTournament = await prisma.tournament.findFirstOrThrow({ where: { name: DEMO_TOURNAMENT_NAME } });
  const recorder = await prisma.user.findUniqueOrThrow({ where: { username: "recorder_demo" } });
  const resultCodeIdByCode = new Map(
    (await prisma.resultCode.findMany({ where: { tournamentId: demoTournament.id } })).map((resultCode) => [resultCode.code, resultCode.id]),
  );
  const roundOneGames = await prisma.game.findMany({
    where: { round: { tournamentId: demoTournament.id, roundNumber: 1 }, blackPlayerId: { not: null } },
    orderBy: { boardNumber: "asc" },
  });
  const act = (gameIndex: number, expectedVersion: number, actionRequest: ResultActionRequest) =>
    prisma.$transaction((transaction) =>
      applyResultTransition({ gameId: (roundOneGames[gameIndex] as { id: string }).id, expectedVersion, actionRequest, actor: recorder }, transaction),
    );
  for (const [gameIndex, code] of [[0, "1-0"], [1, "½-½"]] as const) {
    await act(gameIndex, 0, { type: "SUBMIT_RESULT", resultCodeId: resultCodeIdByCode.get(code) as string });
    await act(gameIndex, 1, { type: "CONFIRM_BY_SIDE", side: "WHITE" });
    await act(gameIndex, 2, { type: "CONFIRM_BY_SIDE", side: "BLACK" });
  }
  await act(2, 0, { type: "SUBMIT_RESULT", resultCodeId: resultCodeIdByCode.get("1-0") as string });
});

describe("queryTournamentList", () => {
  it("lists newest first, 15 per page, with the rest on page 2", async () => {
    const firstPage = await queryTournamentList({ searchText: "", sortOption: "date-desc", pageNumber: 1 });
    expect(firstPage).toMatchObject({ matchingCount: 17, pageNumber: 1, pageCount: 2 });
    expect(firstPage.items).toHaveLength(15);
    const startDates = firstPage.items.map((tournament) => tournament.startDateIso);
    expect([...startDates].sort().reverse()).toEqual(startDates);
    const secondPage = await queryTournamentList({ searchText: "", sortOption: "date-desc", pageNumber: 2 });
    expect(secondPage.items.map((tournament) => tournament.name)).toEqual(["Giải Cờ Nhanh Số 02", "Giải Cờ Nhanh Số 01"]);
  });

  it("counts only OFFICIAL wins and draws, and sorts by most wins and most draws", async () => {
    const byWins = await queryTournamentList({ searchText: "", sortOption: "wins-desc", pageNumber: 1 });
    expect(byWins.items[0]).toMatchObject({ name: DEMO_TOURNAMENT_NAME, winCount: 1, drawCount: 1 });
    expect(byWins.items.slice(1).every((tournament) => tournament.winCount === 0 && tournament.drawCount === 0)).toBe(true);
    const byDraws = await queryTournamentList({ searchText: "", sortOption: "draws-desc", pageNumber: 1 });
    expect(byDraws.items[0]?.name).toBe(DEMO_TOURNAMENT_NAME);
  });

  it("searches name and venue without diacritics", async () => {
    const byName = await queryTournamentList({ searchText: "CO NHANH so 05", sortOption: "name-asc", pageNumber: 1 });
    expect(byName.items.map((tournament) => tournament.name)).toEqual(["Giải Cờ Nhanh Số 05"]);
    const byVenue = await queryTournamentList({ searchText: "thanh nien", sortOption: "date-desc", pageNumber: 1 });
    expect(byVenue.items.map((tournament) => tournament.name)).toEqual(["Giải Cờ Nhanh Số 01"]);
  });
});
