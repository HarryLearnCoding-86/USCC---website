// src/server/services/tournament-service.ts
// Tournament use cases (SRS-TOUR-01..06, BR-01): list, read, create (with rounds 1..n and the default result
// codes) and update (all fields stay editable during the event; the round list follows roundsCount, but rounds
// that already have games are never removed).

import { vi } from "@/i18n/vi";
import { prisma } from "@/server/database/prisma-client";
import type { DatabaseClient } from "@/server/database/database-client";
import { DEFAULT_RESULT_CODES } from "@/server/domain/default-result-codes";
import { ApiError } from "@/server/http/api-error";
import type { TournamentInput } from "@/server/validation/phase-two-input-schemas";

/** Editable tournament fields as the settings form shows them. */
export interface TournamentSettingsView {
  id: string;
  name: string;
  /** "YYYY-MM-DD" for <input type="date">. */
  startDate: string;
  endDate: string;
  venue: string | null;
  organizer: string | null;
  roundsCount: number;
  timezone: string;
  primaryColor: string | null;
  secondaryColor: string | null;
}

/**
 * Formats a DATE column value for a date input.
 *
 * @param calendarDate - UTC-midnight date.
 * @returns "YYYY-MM-DD".
 */
function toDateInputValue(calendarDate: Date): string {
  return calendarDate.toISOString().slice(0, 10);
}

/**
 * Loads the editable fields of a tournament.
 *
 * @param tournamentId - Tournament ID.
 * @param database - Optional transaction client.
 * @returns Settings view.
 * @throws ApiError 404 TOURNAMENT_NOT_FOUND.
 */
export async function getTournamentSettings(tournamentId: string, database: DatabaseClient = prisma): Promise<TournamentSettingsView> {
  const tournament = await database.tournament.findUnique({ where: { id: tournamentId } });
  if (!tournament) {
    throw new ApiError(404, "TOURNAMENT_NOT_FOUND", vi.tournaments.tournamentNotFound);
  }
  return {
    id: tournament.id,
    name: tournament.name,
    startDate: toDateInputValue(tournament.startDate),
    endDate: toDateInputValue(tournament.endDate),
    venue: tournament.venue,
    organizer: tournament.organizer,
    roundsCount: tournament.roundsCount,
    timezone: tournament.timezone,
    primaryColor: tournament.primaryColor,
    secondaryColor: tournament.secondaryColor,
  };
}

/**
 * Creates a tournament with rounds 1..roundsCount and the SRS-TOUR-06 default result codes.
 *
 * @param tournamentInput - Validated fields.
 * @param database - Transaction client of the request.
 * @returns The new tournament's settings.
 */
export async function createTournament(tournamentInput: TournamentInput, database: DatabaseClient): Promise<TournamentSettingsView> {
  const tournament = await database.tournament.create({
    data: {
      ...tournamentInput,
      rounds: {
        create: Array.from({ length: tournamentInput.roundsCount }, (_unused, roundIndex) => ({ roundNumber: roundIndex + 1 })),
      },
      resultCodes: { create: DEFAULT_RESULT_CODES.map((resultCode) => ({ ...resultCode })) },
    },
  });
  return getTournamentSettings(tournament.id, database);
}

/**
 * Updates a tournament and adds or removes rounds to match roundsCount.
 *
 * @param tournamentId - Tournament ID.
 * @param tournamentInput - Validated fields.
 * @param database - Transaction client of the request.
 * @returns The updated settings.
 * @throws ApiError 404 TOURNAMENT_NOT_FOUND; 409 ROUNDS_HAVE_GAMES when shrinking would drop a round with games.
 */
export async function updateTournament(
  tournamentId: string,
  tournamentInput: TournamentInput,
  database: DatabaseClient,
): Promise<TournamentSettingsView> {
  const existingRounds = await database.round.findMany({
    where: { tournamentId },
    select: { id: true, roundNumber: true, _count: { select: { games: true } } },
  });
  const tournamentExists = (await database.tournament.count({ where: { id: tournamentId } })) > 0;
  if (!tournamentExists) {
    throw new ApiError(404, "TOURNAMENT_NOT_FOUND", vi.tournaments.tournamentNotFound);
  }
  const roundsToRemove = existingRounds.filter((round) => round.roundNumber > tournamentInput.roundsCount);
  const roundWithGames = roundsToRemove.find((round) => round._count.games > 0);
  if (roundWithGames) {
    throw new ApiError(409, "ROUNDS_HAVE_GAMES", vi.tournaments.roundsHaveGames(roundWithGames.roundNumber));
  }
  await database.round.deleteMany({ where: { id: { in: roundsToRemove.map((round) => round.id) } } });
  const existingRoundNumbers = new Set(existingRounds.map((round) => round.roundNumber));
  const missingRoundNumbers = Array.from({ length: tournamentInput.roundsCount }, (_unused, roundIndex) => roundIndex + 1).filter(
    (roundNumber) => !existingRoundNumbers.has(roundNumber),
  );
  await database.round.createMany({ data: missingRoundNumbers.map((roundNumber) => ({ tournamentId, roundNumber })) });
  await database.tournament.update({ where: { id: tournamentId }, data: tournamentInput });
  return getTournamentSettings(tournamentId, database);
}
