// src/server/services/manual-pairing-service.ts
// Manual pairing entry per board (SRS-IMP-13), used until the Swiss-Manager importer is final.
// Validation reuses the SRS-IMP-06 rules; players are resolved by ID first and never auto-merged (SRS-IMP-08).
// A board whose result is not NONE cannot be edited, and a board with result history cannot be deleted:
// pairings never silently overwrite results (CLAUDE.md §2) — the TD cancels the result first.

import { Prisma } from "@prisma/client";
import { vi } from "@/i18n/vi";
import type { DatabaseClient } from "@/server/database/database-client";
import {
  resolvePlayerForSide,
  validateManualPairing,
  type ManualPairingProblem,
  type ManualPairingSideInput,
  type PlayerResolution,
} from "@/server/domain/manual-pairing-rules";
import { ApiError } from "@/server/http/api-error";
import { getGameView } from "@/server/services/game-query-service";
import type { GameView } from "@/server/services/game-view-mapper";
import type { ManualPairingInput } from "@/server/validation/phase-two-input-schemas";

/** Identifies the board being edited; null originalBoardNumber means a new board. */
export interface ManualBoardTarget {
  tournamentId: string;
  roundNumber: number;
  originalBoardNumber: number | null;
}

/**
 * Creates or updates one board of a round.
 *
 * @param target - Tournament, round and (for edits) the board's current number.
 * @param pairingInput - Validated board data; black null means a bye.
 * @param database - Transaction client of the request.
 * @returns The saved game.
 * @throws ApiError 404 ROUND_NOT_FOUND / GAME_NOT_FOUND; 409 GAME_HAS_RESULT / DUPLICATE_BOARD;
 *   400 PAIRING_INVALID with per-field details.
 */
export async function saveManualBoard(target: ManualBoardTarget, pairingInput: ManualPairingInput, database: DatabaseClient): Promise<GameView> {
  const round = await findRound(target, database);
  const roundGames = await database.game.findMany({
    where: { roundId: round.id },
    select: { id: true, boardNumber: true, whitePlayerId: true, blackPlayerId: true, result: { select: { status: true } } },
  });
  const existingGame = target.originalBoardNumber === null ? null : roundGames.find((game) => game.boardNumber === target.originalBoardNumber);
  if (target.originalBoardNumber !== null && !existingGame) {
    throw new ApiError(404, "GAME_NOT_FOUND", vi.manualPairing.gameNotFound);
  }
  if (existingGame?.result && existingGame.result.status !== "NONE") {
    throw new ApiError(409, "GAME_HAS_RESULT", vi.manualPairing.gameHasResult);
  }
  const otherGames = roundGames.filter((game) => game.id !== existingGame?.id);
  if (otherGames.some((game) => game.boardNumber === pairingInput.boardNumber)) {
    throw new ApiError(409, "DUPLICATE_BOARD", vi.manualPairing.duplicateBoard(pairingInput.boardNumber));
  }

  const knownPlayers = await database.player.findMany({
    where: { tournamentId: target.tournamentId },
    select: { id: true, swissManagerPlayerId: true, fullName: true },
  });
  const whiteResolution = resolvePlayerForSide(pairingInput.white, knownPlayers);
  const blackResolution = pairingInput.black ? resolvePlayerForSide(pairingInput.black, knownPlayers) : null;
  const problems = validateManualPairing(
    pairingInput.boardNumber,
    { white: whiteResolution, black: blackResolution },
    otherGames.map((game) => ({ boardNumber: game.boardNumber, playerIds: [game.whitePlayerId, game.blackPlayerId].filter((playerId): playerId is string => playerId !== null) })),
  );
  if (problems.length > 0) {
    const firstProblem = problems[0] as ManualPairingProblem;
    throw new ApiError(400, "PAIRING_INVALID", describePairingProblem(firstProblem), problems);
  }

  const whitePlayerId = await materializePlayer(target.tournamentId, pairingInput.white, whiteResolution, database);
  const blackPlayerId =
    pairingInput.black && blackResolution ? await materializePlayer(target.tournamentId, pairingInput.black, blackResolution, database) : null;
  const gameData = {
    boardNumber: pairingInput.boardNumber,
    whitePlayerId,
    blackPlayerId,
    whitePointsBefore: toDecimalOrNull(pairingInput.white.pointsBefore),
    blackPointsBefore: toDecimalOrNull(pairingInput.black?.pointsBefore ?? null),
  };
  const savedGame = existingGame
    ? await database.game.update({ where: { id: existingGame.id }, data: gameData })
    : await database.game.create({ data: { ...gameData, roundId: round.id, result: { create: { status: "NONE" } } } });
  return getGameView(savedGame.id, database);
}

/**
 * Deletes a board that never had a result.
 *
 * @param target - Tournament, round and board number (originalBoardNumber).
 * @param database - Transaction client of the request.
 * @throws ApiError 404 GAME_NOT_FOUND; 409 GAME_HAS_RESULT / GAME_HAS_HISTORY.
 */
export async function deleteManualBoard(target: ManualBoardTarget & { originalBoardNumber: number }, database: DatabaseClient): Promise<void> {
  const round = await findRound(target, database);
  const game = await database.game.findUnique({
    where: { roundId_boardNumber: { roundId: round.id, boardNumber: target.originalBoardNumber } },
    include: { result: { select: { status: true, _count: { select: { events: true } } } } },
  });
  if (!game) {
    throw new ApiError(404, "GAME_NOT_FOUND", vi.manualPairing.gameNotFound);
  }
  if (game.result && game.result.status !== "NONE") {
    throw new ApiError(409, "GAME_HAS_RESULT", vi.manualPairing.gameHasResult);
  }
  if (game.result && game.result._count.events > 0) {
    throw new ApiError(409, "GAME_HAS_HISTORY", vi.manualPairing.gameHasHistory);
  }
  await database.game.delete({ where: { id: game.id } });
}

/**
 * Finds the round row.
 *
 * @throws ApiError 404 ROUND_NOT_FOUND.
 */
async function findRound(target: ManualBoardTarget, database: DatabaseClient) {
  const round = await database.round.findUnique({
    where: { tournamentId_roundNumber: { tournamentId: target.tournamentId, roundNumber: target.roundNumber } },
  });
  if (!round) {
    throw new ApiError(404, "ROUND_NOT_FOUND", vi.tournaments.roundNotFound);
  }
  return round;
}

/**
 * Returns the player ID for a resolved side, creating the player when the resolution says so.
 *
 * @param tournamentId - Owning tournament.
 * @param sideInput - Typed side.
 * @param resolution - Outcome of resolvePlayerForSide (conflicts were rejected earlier).
 * @param database - Transaction client.
 * @returns Player ID.
 */
async function materializePlayer(
  tournamentId: string,
  sideInput: ManualPairingSideInput,
  resolution: PlayerResolution,
  database: DatabaseClient,
): Promise<string> {
  if (resolution.kind === "EXISTING") {
    return resolution.playerId;
  }
  const createdPlayer = await database.player.create({
    data: {
      tournamentId,
      swissManagerPlayerId: sideInput.swissManagerPlayerId,
      fullName: sideInput.fullName,
      clubOrFederation: sideInput.clubOrFederation,
    },
  });
  return createdPlayer.id;
}

/**
 * Converts points to a Prisma Decimal.
 *
 * @param points - Number in 0.5 steps, or null.
 * @returns Decimal or null.
 */
function toDecimalOrNull(points: number | null): Prisma.Decimal | null {
  return points === null ? null : new Prisma.Decimal(points);
}

/**
 * Vietnamese message for a pairing problem.
 *
 * @param problem - Problem from validateManualPairing.
 * @returns Message from vi.ts.
 */
export function describePairingProblem(problem: ManualPairingProblem): string {
  switch (problem.code) {
    case "BOARD_NOT_POSITIVE_INTEGER":
      return vi.manualPairing.boardNotPositive;
    case "PLAYER_ID_NAME_MISMATCH":
      return vi.manualPairing.idNameMismatch(problem.existingName);
    case "AMBIGUOUS_PLAYER_NAME":
      return vi.manualPairing.ambiguousName(problem.matchCount);
    case "PLAYER_ON_ANOTHER_BOARD":
      return vi.manualPairing.playerOnAnotherBoard(problem.otherBoardNumber);
    case "SAME_PLAYER_BOTH_SIDES":
      return vi.manualPairing.samePlayerBothSides;
  }
}
