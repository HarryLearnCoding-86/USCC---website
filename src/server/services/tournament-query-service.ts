// src/server/services/tournament-query-service.ts
// Read-only tournament queries for the home page: tournaments with their rounds, newest first.
// Full tournament management (create, settings, result codes) arrives in Phase 2.

import { prisma } from "@/server/database/prisma-client";
import { formatCalendarDate } from "@/server/domain/date-time-format";

/** A tournament as listed on the home page. */
export interface TournamentListItem {
  id: string;
  name: string;
  venue: string | null;
  startDateText: string;
  endDateText: string;
  roundNumbers: number[];
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
  }));
}
