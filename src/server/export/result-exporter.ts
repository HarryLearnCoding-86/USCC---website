// src/server/export/result-exporter.ts
// The ResultExporter interface (AGENT_PROMPT.md §3.7, SRS-EXP-05). The export service collects the data; an
// exporter only lays it out. When the Swiss-Manager re-import format is confirmed (open question OI-02), a new
// implementation replaces the generic one without touching data loading, routes or pages.

import type { ResultStatus } from "@prisma/client";

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
