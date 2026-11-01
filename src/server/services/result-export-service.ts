// src/server/services/result-export-service.ts
// Collects results for an export (SRS-EXP-01..05, BR-09, BR-15): one round or the whole tournament, OFFICIAL results
// by default, or a separate reconciliation file of results that are not official yet (PENDING, DISPUTED, REOPENED).
// The status filter is applied in the database query, so a default export can never contain a non-official result
// (CLAUDE.md §2). Each row also names the winner (game-winner.ts). Layout is delegated to a ResultExporter.

import type { ResultStatus } from "@prisma/client";
import { vi } from "@/i18n/vi";
import { prisma } from "@/server/database/prisma-client";
import { formatInstantInTimezone } from "@/server/domain/date-time-format";
import { determineGameOutcome, selectWinningSide } from "@/server/domain/game-winner";
import { GenericResultWorkbookExporter } from "@/server/export/generic-result-workbook-exporter";
import type { ExportContent, ExportedFile, ResultExporter } from "@/server/export/result-exporter";
import { ApiError } from "@/server/http/api-error";

/** Statuses per export content. RECONCILIATION adds REOPENED to SRS-EXP-04's PENDING and DISPUTED: also unresolved. */
const STATUSES_BY_CONTENT: Record<ExportContent, ResultStatus[]> = {
  OFFICIAL: ["OFFICIAL"],
  RECONCILIATION: ["PENDING", "DISPUTED", "REOPENED"],
};

/** What to export. */
export interface ResultExportRequest {
  tournamentId: string;
  /** null for the whole tournament. */
  roundNumber: number | null;
  content: ExportContent;
}

/**
 * Builds an export file.
 *
 * @param exportRequest - Tournament, scope and content.
 * @param resultExporter - Layout implementation (generic workbook by default).
 * @param now - Generation time; injectable for tests.
 * @returns The file to download.
 * @throws ApiError 404 TOURNAMENT_NOT_FOUND or ROUND_NOT_FOUND.
 */
export async function buildResultExport(
  exportRequest: ResultExportRequest,
  resultExporter: ResultExporter = new GenericResultWorkbookExporter(),
  now: Date = new Date(),
): Promise<ExportedFile> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: exportRequest.tournamentId },
    include: { rounds: { select: { roundNumber: true } } },
  });
  if (!tournament) throw new ApiError(404, "TOURNAMENT_NOT_FOUND", vi.tournaments.tournamentNotFound);
  if (exportRequest.roundNumber !== null && !tournament.rounds.some((round) => round.roundNumber === exportRequest.roundNumber)) {
    throw new ApiError(404, "ROUND_NOT_FOUND", vi.tournaments.roundNotFound);
  }

  const games = await prisma.game.findMany({
    where: {
      round: { tournamentId: tournament.id, ...(exportRequest.roundNumber === null ? {} : { roundNumber: exportRequest.roundNumber }) },
      result: { status: { in: STATUSES_BY_CONTENT[exportRequest.content] } },
    },
    include: {
      round: { select: { roundNumber: true } },
      whitePlayer: { select: { swissManagerPlayerId: true, fullName: true } },
      blackPlayer: { select: { swissManagerPlayerId: true, fullName: true } },
      result: { select: { status: true, resultCode: { select: { code: true, labelVi: true, swissManagerValue: true, whiteScore: true, blackScore: true } } } },
    },
    orderBy: [{ round: { roundNumber: "asc" } }, { boardNumber: "asc" }],
  });

  return resultExporter.buildExportFile({
    tournamentName: tournament.name,
    scopeLabel: exportRequest.roundNumber === null ? vi.importExport.exportScopeAll : vi.importExport.exportScopeRound(exportRequest.roundNumber),
    content: exportRequest.content,
    generatedAtText: formatInstantInTimezone(now, tournament.timezone),
    generatedAtIso: now.toISOString(),
    rows: games.map((game) => {
      const resultCode = game.result?.resultCode ?? null;
      const whiteScore = resultCode ? resultCode.whiteScore.toNumber() : null;
      const blackScore = resultCode ? resultCode.blackScore.toNumber() : null;
      const outcome = determineGameOutcome({ whiteScore, blackScore, hasBlackPlayer: game.blackPlayer !== null });
      const winningSide = selectWinningSide(outcome);
      const winningPlayer = winningSide === "WHITE" ? game.whitePlayer : winningSide === "BLACK" ? game.blackPlayer : null;
      return {
        roundNumber: game.round.roundNumber,
        boardNumber: game.boardNumber,
        whitePlayerId: game.whitePlayer.swissManagerPlayerId,
        whiteName: game.whitePlayer.fullName,
        blackPlayerId: game.blackPlayer?.swissManagerPlayerId ?? null,
        blackName: game.blackPlayer?.fullName ?? null,
        swissManagerResultValue: resultCode ? (resultCode.swissManagerValue ?? resultCode.code) : null,
        resultLabelVi: resultCode?.labelVi ?? null,
        whiteScore,
        blackScore,
        outcome,
        winnerPlayerId: winningPlayer?.swissManagerPlayerId ?? null,
        winnerName: winningPlayer?.fullName ?? null,
        status: game.result?.status ?? "NONE",
      };
    }),
  });
}
