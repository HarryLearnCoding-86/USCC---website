// src/server/services/tournament-query-service.ts
// Read-only tournament queries for the home page and /tournaments: tournaments with their rounds, newest first,
// and the searchable, sortable 15-per-page list with each tournament's official win and draw counts.

import { prisma } from "@/server/database/prisma-client";
import { formatCalendarDate } from "@/server/domain/date-time-format";
import { determineGameOutcome } from "@/server/domain/game-winner";
import { buildTournamentLogoUrl } from "@/server/domain/tournament-logo-url";
import {
  selectTournamentListPage,
  type TournamentListFields,
  type TournamentListPage,
  type TournamentListQuery,
} from "@/server/domain/tournament-list-rules";

/** A tournament as listed on the home page. */
export interface TournamentListItem {
  id: string;
  name: string;
  venue: string | null;
  startDateText: string;
  endDateText: string;
  roundNumbers: number[];
  /** Logo shown next to the name, or null when none was uploaded. */
  logoUrl: string | null;
}

/**
 * Lists every tournament with its round numbers.
 *
 * @returns Tournaments ordered by start date, newest first; dates pre-formatted as DD/MM/YYYY.
 */
export async function listTournamentsWithRounds(): Promise<TournamentListItem[]> {
  const tournaments = await prisma.tournament.findMany({
    orderBy: { startDate: "desc" },
    include: { rounds: { select: { roundNumber: true }, orderBy: { roundNumber: "asc" } } },
  });
  return tournaments.map((tournament) => ({
    id: tournament.id,
    name: tournament.name,
    venue: tournament.venue,
    startDateText: formatCalendarDate(tournament.startDate),
    endDateText: formatCalendarDate(tournament.endDate),
    roundNumbers: tournament.rounds.map((round) => round.roundNumber),
    logoUrl: buildTournamentLogoUrl(tournament.id, tournament.logoStorageKey),
  }));
}

/** A tournament on the searchable list, with its official win and draw counts. */
export interface TournamentListEntry extends TournamentListItem, TournamentListFields {}

/**
 * Counts official wins and draws per tournament (byes excluded, as they are not games).
 * Grouped by result code in the database: each code belongs to one tournament and fixes the scores, so the
 * winner rule (game-winner.ts) runs once per code instead of once per game.
 *
 * @returns Map of tournament ID to { winCount, drawCount }; tournaments without official games are absent.
 */
async function countOfficialWinsAndDrawsByTournament(): Promise<Map<string, { winCount: number; drawCount: number }>> {
  const officialResultsByCode = await prisma.result.groupBy({
    by: ["resultCodeId"],
    where: { status: "OFFICIAL", resultCodeId: { not: null }, game: { blackPlayerId: { not: null } } },
    _count: { _all: true },
  });
  const resultCodes = await prisma.resultCode.findMany({
    where: { id: { in: officialResultsByCode.map((codeGroup) => codeGroup.resultCodeId).filter((resultCodeId): resultCodeId is string => resultCodeId !== null) } },
    select: { id: true, tournamentId: true, whiteScore: true, blackScore: true },
  });
  const resultCodesById = new Map(resultCodes.map((resultCode) => [resultCode.id, resultCode]));
  const countsByTournament = new Map<string, { winCount: number; drawCount: number }>();
  for (const codeGroup of officialResultsByCode) {
    const resultCode = codeGroup.resultCodeId === null ? undefined : resultCodesById.get(codeGroup.resultCodeId);
    if (!resultCode) continue;
    const outcome = determineGameOutcome({ whiteScore: resultCode.whiteScore.toNumber(), blackScore: resultCode.blackScore.toNumber(), hasBlackPlayer: true });
    const tournamentCounts = countsByTournament.get(resultCode.tournamentId) ?? { winCount: 0, drawCount: 0 };
    if (outcome === "WHITE_WINS" || outcome === "BLACK_WINS") tournamentCounts.winCount += codeGroup._count._all;
    if (outcome === "DRAW") tournamentCounts.drawCount += codeGroup._count._all;
    countsByTournament.set(resultCode.tournamentId, tournamentCounts);
  }
  return countsByTournament;
}

/**
 * Lists one page of tournaments: searched, sorted (newest first by default) and cut to 15.
 *
 * @param listQuery - Search text, sort option and page number.
 * @returns The page with counts for the pager.
 */
export async function queryTournamentList(listQuery: TournamentListQuery): Promise<TournamentListPage<TournamentListEntry>> {
  const [tournaments, countsByTournament] = await Promise.all([
    prisma.tournament.findMany({ include: { rounds: { select: { roundNumber: true }, orderBy: { roundNumber: "asc" } } } }),
    countOfficialWinsAndDrawsByTournament(),
  ]);
  const entries: TournamentListEntry[] = tournaments.map((tournament) => ({
    id: tournament.id,
    name: tournament.name,
    venue: tournament.venue,
    organizer: tournament.organizer,
    startDateIso: tournament.startDate.toISOString().slice(0, 10),
    startDateText: formatCalendarDate(tournament.startDate),
    endDateText: formatCalendarDate(tournament.endDate),
    roundNumbers: tournament.rounds.map((round) => round.roundNumber),
    logoUrl: buildTournamentLogoUrl(tournament.id, tournament.logoStorageKey),
    winCount: countsByTournament.get(tournament.id)?.winCount ?? 0,
    drawCount: countsByTournament.get(tournament.id)?.drawCount ?? 0,
  }));
  return selectTournamentListPage(entries, listQuery);
}
