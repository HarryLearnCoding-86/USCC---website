// src/server/import/pairing-importer.ts
// The PairingImporter interface (AGENT_PROMPT.md §3.7). The import service depends only on this interface, so the
// spreadsheet reader can be replaced once the real Swiss-Manager export is known (open question OI-01) without
// touching validation, diff or persistence. Implementations must not assume a sheet layout (SRS-IMP-12).

import type { MappedSheetRow, PairingColumnMapping } from "@/server/domain/pairing-import-rules";

/** One sheet as shown in the "choose sheet" and "map columns" steps. */
export interface WorkbookSheetOutline {
  sheetName: string;
  rowCount: number;
  columnCount: number;
  /** First row with ≥ 4 non-empty text cells (SRS-IMP-02), or null. */
  detectedHeaderRowNumber: number | null;
  /** The first rows of the sheet, for the TD to see where the data starts. */
  previewRows: { rowNumber: number; cellTextByColumnLetter: Record<string, string> }[];
}

/** Outline of an uploaded workbook. */
export interface WorkbookOutline {
  sheets: WorkbookSheetOutline[];
}

/** Which sheet, header row and column mapping to read. */
export interface PairingReadRequest {
  sheetName: string;
  headerRowNumber: number;
  columnMapping: PairingColumnMapping;
}

/** Rows read from the mapped sheet. */
export interface MappedSheetData {
  sheetName: string;
  /** Header text per column letter, for messages and the preview. */
  headerTextByColumnLetter: Record<string, string>;
  /** Rows below the header that carry pairing data. */
  dataRows: MappedSheetRow[];
  /** Rows below the header skipped because every player name/ID cell is empty (blank lines, footers). */
  skippedRowNumbers: number[];
}

/** Reads pairing data from an uploaded file. */
export interface PairingImporter {
  /**
   * Lists the sheets with a preview of their first rows.
   * @param fileBytes - Uploaded file.
   * @returns The outline.
   * @throws ApiError 400 when the file is not a readable workbook.
   */
  readWorkbookOutline(fileBytes: Uint8Array): Promise<WorkbookOutline>;
  /**
   * Reads the rows of one sheet through the TD's column mapping.
   * @param fileBytes - Uploaded file.
   * @param readRequest - Sheet, header row and mapping.
   * @returns Mapped rows.
   * @throws ApiError 400 when the sheet does not exist or the file is unreadable.
   */
  readMappedRows(fileBytes: Uint8Array, readRequest: PairingReadRequest): Promise<MappedSheetData>;
}
