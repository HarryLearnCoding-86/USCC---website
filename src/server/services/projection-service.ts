// src/server/services/projection-service.ts
// Data for the projection screen (SRS-PROJ-01..08). Filtering happens here, on the server: only OFFICIAL results
// carry a result, so PENDING, DISPUTED and REOPENED results can never reach the projector, whatever the client
// does (FR-06, CLAUDE.md §2). Points come only from imported/entered data and are marked provisional.

import { vi } from "@/i18n/vi";
import { prisma } from "@/server/database/prisma-client";
import { formatScore, formatScoreLine } from "@/server/domain/result-display";
import { ApiError } from "@/server/http/api-error";

/** One projected board. */
export interface ProjectionGame {
  boardNumber: number;
  whiteName: string;
  /** Provisional points before the round, pre-formatted with ½, or null when unknown. */
  whitePointsText: string | null;
  /** null for a bye (SRS-PROJ-08). */
  blackName: string | null;
  blackPointsText: string | null;
  /** Present only for OFFICIAL results. */
  officialResult: { scoreLine: string; labelVi: string; isWithoutPlayerConfirmation: boolean } | null;
}

/** Everything the projection screen renders. */
export interface ProjectionView {
  tournamentId: string;
  tournamentName: string;
  timezone: string;
  primaryColor: string | null;
  secondaryColor: string | null;
  /** Cache-busting logo URL, or null when no logo. */
  logoUrl: string | null;
  roundNumber: number;
  roundNumbers: number[];
  hasProvisionalPoints: boolean;
  games: ProjectionGame[];
  generatedAt: string;
}

/**
 * Chooses the round to project: the requested one if it exists, otherwise the latest round that has games,
 * otherwise round 1.
 *
 * @param roundsWithGameCounts - Rounds of the tournament with their game counts.
 * @param requestedRoundNumber - Round from the URL, if any.
 * @returns Round number to show.
 */
export function chooseProjectedRoundNumber(
  roundsWithGameCounts: { roundNumber: number; gameCount: number }[],
  requestedRoundNumber: number | null,
): number {
  if (requestedRoundNumber !== null && roundsWithGameCounts.some((round) => round.roundNumber === requestedRoundNumber)) {
    return requestedRoundNumber;
  }
  const roundsWithGames = roundsWithGameCounts.filter((round) => round.gameCount > 0).map((round) => round.roundNumber);
  return roundsWithGames.length > 0 ? Math.max(...roundsWithGames) : (roundsWithGameCounts[0]?.roundNumber ?? 1);
}

/**
 * Builds the projection view for a round.
 *
 * @param tournamentId - Tournament ID.
 * @param requestedRoundNumber - Round from the URL, or null for the default.
 * @returns The view with only official results filled in.
 * @throws ApiError 404 TOURNAMENT_NOT_FOUND.
 */
export async function getProjectionView(tournamentId: string, requestedRoundNumber: number | null): Promise<ProjectionView> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: { rounds: { select: { id: true, roundNumber: true, _count: { select: { games: true } } }, orderBy: { roundNumber: "asc" } } },
  });
  if (!tournament) {
    throw new ApiError(404, "TOURNAMENT_NOT_FOUND", vi.tournaments.tournamentNotFound);
  }
  const roundNumber = chooseProjectedRoundNumber(
    tournament.rounds.map((round) => ({ roundNumber: round.roundNumber, gameCount: round._count.games })),
    requestedRoundNumber,
  );
  const roundId = tournament.rounds.find((round) => round.roundNumber === roundNumber)?.id;
  const games = roundId
    ? await prisma.game.findMany({
        where: { roundId },
        orderBy: { boardNumber: "asc" },
        include: {
          whitePlayer: { select: { fullName: true } },
          blackPlayer: { select: { fullName: true } },
          // FR-06: only OFFICIAL results are loaded with their code; anything else is never read for projection.
          result: { select: { status: true, resultCode: true } },
        },
      })
    : [];

  const projectionGames: ProjectionGame[] = games.map((game) => {
    const officialCode = game.result?.status === "OFFICIAL" ? game.result.resultCode : null;
    return {
      boardNumber: game.boardNumber,
      whiteName: game.whitePlayer.fullName,
      whitePointsText: game.whitePointsBefore === null ? null : formatScore(game.whitePointsBefore.toNumber()),
      blackName: game.blackPlayer?.fullName ?? null,
      blackPointsText: game.blackPlayer && game.blackPointsBefore !== null ? formatScore(game.blackPointsBefore.toNumber()) : null,
      officialResult: officialCode
        ? {
            scoreLine: formatScoreLine(officialCode.whiteScore.toNumber(), officialCode.blackScore.toNumber()),
            labelVi: officialCode.labelVi,
            isWithoutPlayerConfirmation: !officialCode.requiresPlayerConfirmation,
          }
        : null,
    };
  });

  return {
    tournamentId: tournament.id,
    tournamentName: tournament.name,
    timezone: tournament.timezone,
    primaryColor: tournament.primaryColor,
    secondaryColor: tournament.secondaryColor,
    logoUrl: tournament.logoStorageKey ? `/api/tournaments/${tournament.id}/logo?v=${encodeURIComponent(tournament.logoStorageKey)}` : null,
    roundNumber,
    roundNumbers: tournament.rounds.map((round) => round.roundNumber),
    hasProvisionalPoints: projectionGames.some((game) => game.whitePointsText !== null || game.blackPointsText !== null),
    games: projectionGames,
    generatedAt: new Date().toISOString(),
  };
}
