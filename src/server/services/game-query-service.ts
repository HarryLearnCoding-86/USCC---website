// src/server/services/game-query-service.ts
// Read-only queries for games: one game (record page), a round's games with search and filter (SRS-LOOK-01..03),
// the TD console overview with status counts and the oldest-first dispute queue (SRS-TD-01, 02), and a game's
// audit history in time order (SRS-TD-05).

import type { ResultStatus } from "@prisma/client";
import { vi } from "@/i18n/vi";
import { prisma } from "@/server/database/prisma-client";
import type { DatabaseClient } from "@/server/database/database-client";
import { formatInstantInTimezone } from "@/server/domain/date-time-format";
import { doesGameMatchSearch } from "@/server/domain/game-search-filter";
import { ApiError } from "@/server/http/api-error";
import { GAME_VIEW_INCLUDE, toGameView, toResultCodeView, type GameView, type ResultCodeView } from "@/server/services/game-view-mapper";

/** Tournament facts every game page needs. */
export interface TournamentSummary {
  id: string;
  name: string;
  timezone: string;
  roundNumbers: number[];
  primaryColor: string | null;
  secondaryColor: string | null;
  logoStorageKey: string | null;
}

/** One audit event as shown in the history panel. */
export interface GameHistoryEntry {
  id: string;
  action: string;
  actorUsername: string | null;
  reason: string | null;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
  /** createdAt in the tournament timezone, DD/MM/YYYY HH:mm (SRS-AUD-01). */
  createdAtText: string;
}

/** Everything the TD console shows for one round. */
export interface ConsoleOverview {
  roundNumber: number;
  statusCounts: Record<ResultStatus, number>;
  games: GameView[];
  /** DISPUTED results across all rounds, oldest dispute first (SRS-TD-02). */
  disputedQueue: GameView[];
  resultCodes: ResultCodeView[];
}

const ALL_RESULT_STATUSES: ResultStatus[] = ["NONE", "PENDING", "DISPUTED", "OFFICIAL", "REOPENED"];

/**
 * Loads a tournament summary.
 *
 * @param tournamentId - Tournament ID.
 * @param database - Optional transaction client.
 * @returns The summary.
 * @throws ApiError 404 TOURNAMENT_NOT_FOUND.
 */
export async function getTournamentSummary(tournamentId: string, database: DatabaseClient = prisma): Promise<TournamentSummary> {
  const tournament = await database.tournament.findUnique({
    where: { id: tournamentId },
    include: { rounds: { select: { roundNumber: true }, orderBy: { roundNumber: "asc" } } },
  });
  if (!tournament) {
    throw new ApiError(404, "TOURNAMENT_NOT_FOUND", vi.tournaments.tournamentNotFound);
  }
  return {
    id: tournament.id,
    name: tournament.name,
    timezone: tournament.timezone,
    roundNumbers: tournament.rounds.map((round) => round.roundNumber),
    primaryColor: tournament.primaryColor,
    secondaryColor: tournament.secondaryColor,
    logoStorageKey: tournament.logoStorageKey,
  };
}

/**
 * Loads one game with players and result.
 *
 * @param gameId - Game ID.
 * @param database - Optional transaction client.
 * @returns The game view.
 * @throws ApiError 404 GAME_NOT_FOUND.
 */
export async function getGameView(gameId: string, database: DatabaseClient = prisma): Promise<GameView> {
  const game = await database.game.findUnique({ where: { id: gameId }, include: GAME_VIEW_INCLUDE });
  if (!game) {
    throw new ApiError(404, "GAME_NOT_FOUND", vi.resultErrors.gameNotFound);
  }
  return toGameView(game);
}

/**
 * Lists a round's games by board, filtered in memory (a round has at most ~100 boards, NFR-03).
 *
 * @param tournamentId - Tournament ID.
 * @param roundNumber - Round number.
 * @param filter - Search text and optional status.
 * @param database - Optional transaction client.
 * @returns Matching games ordered by board number.
 * @throws ApiError 404 ROUND_NOT_FOUND.
 */
export async function listRoundGames(
  tournamentId: string,
  roundNumber: number,
  filter: { search: string; status?: ResultStatus | undefined } = { search: "" },
  database: DatabaseClient = prisma,
): Promise<GameView[]> {
  const round = await database.round.findUnique({ where: { tournamentId_roundNumber: { tournamentId, roundNumber } } });
  if (!round) {
    throw new ApiError(404, "ROUND_NOT_FOUND", vi.tournaments.roundNotFound);
  }
  const games = await database.game.findMany({
    where: { roundId: round.id },
    include: GAME_VIEW_INCLUDE,
    orderBy: { boardNumber: "asc" },
  });
  return games.map(toGameView).filter((game) => doesGameMatchSearch(game, filter.search, filter.status));
}

/**
 * Lists a tournament's result codes in display order.
 *
 * @param tournamentId - Tournament ID.
 * @param database - Optional transaction client.
 * @returns All codes, active and hidden.
 */
export async function listResultCodes(tournamentId: string, database: DatabaseClient = prisma): Promise<ResultCodeView[]> {
  const resultCodes = await database.resultCode.findMany({
    where: { tournamentId },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });
  return resultCodes.map(toResultCodeView);
}

/**
 * Builds the TD console data for one round.
 *
 * @param tournamentId - Tournament ID.
 * @param roundNumber - Round to show.
 * @returns Counts, games, the dispute queue and the result codes.
 * @throws ApiError 404 when the round does not exist.
 */
export async function getConsoleOverview(tournamentId: string, roundNumber: number): Promise<ConsoleOverview> {
  const games = await listRoundGames(tournamentId, roundNumber);
  const statusCounts = Object.fromEntries(ALL_RESULT_STATUSES.map((status) => [status, 0])) as Record<ResultStatus, number>;
  for (const game of games) {
    statusCounts[game.result.status] += 1;
  }
  const disputedGames = await prisma.game.findMany({
    where: { round: { tournamentId }, result: { status: "DISPUTED" } },
    include: GAME_VIEW_INCLUDE,
    orderBy: { result: { disputedAt: "asc" } },
  });
  return {
    roundNumber,
    statusCounts,
    games,
    disputedQueue: disputedGames.map(toGameView),
    resultCodes: await listResultCodes(tournamentId),
  };
}

/**
 * Lists a game's audit events in time order (SRS-TD-05).
 *
 * @param gameId - Game ID.
 * @returns History entries; empty when the game never had a result.
 * @throws ApiError 404 GAME_NOT_FOUND.
 */
export async function listGameHistory(gameId: string): Promise<GameHistoryEntry[]> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { round: { select: { tournament: { select: { timezone: true } } } }, result: { select: { id: true } } },
  });
  if (!game) {
    throw new ApiError(404, "GAME_NOT_FOUND", vi.resultErrors.gameNotFound);
  }
  if (!game.result) {
    return [];
  }
  const timezone = game.round.tournament.timezone;
  const resultEvents = await prisma.resultEvent.findMany({
    where: { resultId: game.result.id },
    include: { actor: { select: { username: true } } },
    orderBy: { createdAt: "asc" },
  });
  return resultEvents.map((resultEvent) => ({
    id: resultEvent.id,
    action: resultEvent.action,
    actorUsername: resultEvent.actor?.username ?? null,
    reason: resultEvent.reason,
    oldValue: resultEvent.oldValue,
    newValue: resultEvent.newValue,
    createdAt: resultEvent.createdAt.toISOString(),
    createdAtText: formatInstantInTimezone(resultEvent.createdAt, timezone),
  }));
}
