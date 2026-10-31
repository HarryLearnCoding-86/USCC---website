// src/server/services/game-view-mapper.ts
// The JSON-safe shape of a game and its result that pages and API responses share, plus the Prisma
// include/select used to load it. Decimals become numbers and dates ISO strings so the view can cross
// the server→client boundary unchanged.

import type { Prisma, ResultStatus } from "@prisma/client";
import { isOfficialByDoubleConfirmation, type PlayerSide } from "@/server/domain/result-state-machine";

/** A player as shown on a board. */
export interface PlayerView {
  id: string;
  swissManagerPlayerId: string | null;
  fullName: string;
  clubOrFederation: string | null;
  /** Points before the round from the imported/entered data; null when unknown (SRS-PROJ-03). */
  pointsBefore: number | null;
}

/** A tournament result code. */
export interface ResultCodeView {
  id: string;
  code: string;
  labelVi: string;
  whiteScore: number;
  blackScore: number;
  requiresPlayerConfirmation: boolean;
  swissManagerValue: string | null;
  sortOrder: number;
  isActive: boolean;
}

/** The result part of a game. */
export interface ResultView {
  status: ResultStatus;
  version: number;
  resultCode: ResultCodeView | null;
  whiteConfirmedAt: string | null;
  blackConfirmedAt: string | null;
  disputedBySide: PlayerSide | null;
  disputedAt: string | null;
  enteredByUsername: string | null;
  approvedByUsername: string | null;
  approvalReason: string | null;
  /** True only when OFFICIAL through two player confirmations, never for byes or TD approvals (SRS-SM-04). */
  isOfficialByDoubleConfirmation: boolean;
}

/** A game with its players and result. */
export interface GameView {
  gameId: string;
  tournamentId: string;
  roundNumber: number;
  boardNumber: number;
  white: PlayerView;
  /** null for a bye. */
  black: PlayerView | null;
  result: ResultView;
}

/** Prisma include that loads everything toGameView needs. */
export const GAME_VIEW_INCLUDE = {
  round: { select: { roundNumber: true, tournamentId: true } },
  whitePlayer: true,
  blackPlayer: true,
  result: {
    include: {
      resultCode: true,
      enteredBy: { select: { username: true } },
      approvedBy: { select: { username: true } },
    },
  },
} satisfies Prisma.GameInclude;

/** A game row loaded with GAME_VIEW_INCLUDE. */
export type GameWithViewRelations = Prisma.GameGetPayload<{ include: typeof GAME_VIEW_INCLUDE }>;

/**
 * Converts a result code row to its view.
 *
 * @param resultCode - Prisma row.
 * @returns JSON-safe view.
 */
export function toResultCodeView(resultCode: Prisma.ResultCodeGetPayload<object>): ResultCodeView {
  return {
    id: resultCode.id,
    code: resultCode.code,
    labelVi: resultCode.labelVi,
    whiteScore: resultCode.whiteScore.toNumber(),
    blackScore: resultCode.blackScore.toNumber(),
    requiresPlayerConfirmation: resultCode.requiresPlayerConfirmation,
    swissManagerValue: resultCode.swissManagerValue,
    sortOrder: resultCode.sortOrder,
    isActive: resultCode.isActive,
  };
}

/**
 * Converts a player row plus their points before the round to a view.
 *
 * @param player - Prisma player row.
 * @param pointsBefore - Decimal points from the game row, or null.
 * @returns JSON-safe view.
 */
function toPlayerView(player: Prisma.PlayerGetPayload<object>, pointsBefore: Prisma.Decimal | null): PlayerView {
  return {
    id: player.id,
    swissManagerPlayerId: player.swissManagerPlayerId,
    fullName: player.fullName,
    clubOrFederation: player.clubOrFederation,
    pointsBefore: pointsBefore === null ? null : pointsBefore.toNumber(),
  };
}

/**
 * Converts a game row (with GAME_VIEW_INCLUDE) to its view. A game without a result row is shown as NONE
 * at version 0, which is also what the lifecycle service creates on first use.
 *
 * @param game - Prisma game row with relations.
 * @returns JSON-safe view.
 */
export function toGameView(game: GameWithViewRelations): GameView {
  const result = game.result;
  const resultView: ResultView = result
    ? {
        status: result.status,
        version: result.version,
        resultCode: result.resultCode ? toResultCodeView(result.resultCode) : null,
        whiteConfirmedAt: result.whiteConfirmedAt?.toISOString() ?? null,
        blackConfirmedAt: result.blackConfirmedAt?.toISOString() ?? null,
        disputedBySide: result.disputedBySide,
        disputedAt: result.disputedAt?.toISOString() ?? null,
        enteredByUsername: result.enteredBy?.username ?? null,
        approvedByUsername: result.approvedBy?.username ?? null,
        approvalReason: result.approvalReason,
        isOfficialByDoubleConfirmation: isOfficialByDoubleConfirmation(result),
      }
    : {
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
      };
  return {
    gameId: game.id,
    tournamentId: game.round.tournamentId,
    roundNumber: game.round.roundNumber,
    boardNumber: game.boardNumber,
    white: toPlayerView(game.whitePlayer, game.whitePointsBefore),
    black: game.blackPlayer ? toPlayerView(game.blackPlayer, game.blackPointsBefore) : null,
    result: resultView,
  };
}
