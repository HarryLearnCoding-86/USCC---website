// src/server/export/result-exporter.ts
// The ResultExporter interface (AGENT_PROMPT.md §3.7, SRS-EXP-05). The export service collects the data; an
// exporter only lays it out. When the Swiss-Manager re-import format is confirmed (open question OI-02), a new
// implementation replaces the generic one without touching data loading, routes or pages.

import type { ResultStatus } from "@prisma/client";
import type { GameOutcome } from "@/server/domain/game-winner";

/** What is being exported. */
export type ExportContent = "OFFICIAL" | "RECONCILIATION";

/** One game in the export. */
export interface ExportGameRow {
  roundNumber: number;
  boardNumber: number;
  whitePlayerId: string | null;
  whiteName: string;
  /** Both null for a bye. */
  blackPlayerId: string | null;
  blackName: string | null;
  /** Swiss-Manager value of the result code (SRS-EXP-02), or the code itself when no value is configured. */
  swissManagerResultValue: string | null;
  resultLabelVi: string | null;
  /** Points of the result code, stored ½ as 0.5; null when the game has no code yet. */
  whiteScore: number | null;
  blackScore: number | null;
  /** Who won (src/server/domain/game-winner.ts). */
  outcome: GameOutcome;
  /** Swiss-Manager ID and name of the winner; null for draws, byes, double forfeits and games without a result. */
  winnerPlayerId: string | null;
  winnerName: string | null;
  status: ResultStatus;
}

/** Everything an exporter receives. */
export interface ResultExportData {
  tournamentName: string;
  /** "Toàn giải" or "Vòng n". */
  scopeLabel: string;
  content: ExportContent;
  /** Generation time already formatted in the tournament timezone (SRS-EXP-02). */
  generatedAtText: string;
  /** Generation time as ISO 8601 (UTC), for machine-readable formats. */
  generatedAtIso: string;
  rows: ExportGameRow[];
}

/** A file ready to download. */
export interface ExportedFile {
  fileBytes: Uint8Array;
  fileName: string;
  contentType: string;
}

/** Lays out results as a file. */
export interface ResultExporter {
  /**
   * Builds the export file.
   * @param exportData - Header information and rows.
   * @returns The file bytes, name and MIME type.
   */
  buildExportFile(exportData: ResultExportData): Promise<ExportedFile>;
}
