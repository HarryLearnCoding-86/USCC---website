// src/server/import/excel-column-mapping-importer.ts
// PairingImporter for .xlsx files using ExcelJS, driven entirely by the TD's sheet, header-row and column choices
// (SRS-IMP-02, 03, 12). Converts every cell to text the same way regardless of how the exporter stored it
// (numbers, rich text, formulas, hyperlinks, dates), so validation sees one consistent representation.

import ExcelJS from "exceljs";
import { vi } from "@/i18n/vi";
import {
  convertColumnLetterToNumber,
  convertColumnNumberToLetter,
  detectHeaderRowNumber,
  isPairingDataRow,
  PAIRING_IMPORT_FIELDS,
  type MappedSheetRow,
  type PairingImportField,
} from "@/server/domain/pairing-import-rules";
import { ApiError } from "@/server/http/api-error";
import type { MappedSheetData, PairingImporter, PairingReadRequest, WorkbookOutline } from "@/server/import/pairing-importer";

/** Rows shown in the sheet preview step. */
const OUTLINE_PREVIEW_ROW_COUNT = 15;
/** Rows scanned for header auto-detection. */
const HEADER_DETECTION_ROW_COUNT = 30;

/**
 * Converts an ExcelJS cell value to display text.
 *
 * @param cellValue - Raw ExcelJS value.
 * @returns Trimmed text ("" for empty cells).
 */
export function convertCellValueToText(cellValue: ExcelJS.CellValue): string {
  if (cellValue === null || cellValue === undefined) return "";
  if (typeof cellValue === "string") return cellValue.trim();
  if (typeof cellValue === "number") return Number.isInteger(cellValue) ? String(cellValue) : String(Number(cellValue.toFixed(6)));
  if (typeof cellValue === "boolean") return cellValue ? "TRUE" : "FALSE";
  if (cellValue instanceof Date) return cellValue.toISOString().slice(0, 10);
  if (typeof cellValue === "object") {
    if ("richText" in cellValue) return cellValue.richText.map((textRun) => textRun.text).join("").trim();
    if ("result" in cellValue) return convertCellValueToText(cellValue.result as ExcelJS.CellValue);
    if ("text" in cellValue) return String(cellValue.text).trim();
    if ("error" in cellValue) return "";
  }
  return String(cellValue).trim();
}

/**
 * Loads a workbook from bytes.
 *
 * @param fileBytes - Uploaded file.
 * @returns The workbook.
 * @throws ApiError 400 IMPORT_FILE_UNREADABLE.
 */
async function loadWorkbook(fileBytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  try {
    // ExcelJS's typings expect a Node Buffer; the bytes are copied, never executed.
    await workbook.xlsx.load(Buffer.from(fileBytes) as unknown as ArrayBuffer);
  } catch {
    throw new ApiError(400, "IMPORT_FILE_UNREADABLE", vi.importExport.fileUnreadable);
  }
  return workbook;
}

/**
 * Reads one row as text per column letter.
 *
 * @param worksheet - Sheet.
 * @param rowNumber - 1-based row.
 * @param columnCount - Columns to read.
 * @returns Column letter → text (empty cells omitted).
 */
function readRowTexts(worksheet: ExcelJS.Worksheet, rowNumber: number, columnCount: number): Record<string, string> {
  const row = worksheet.getRow(rowNumber);
  const cellTextByColumnLetter: Record<string, string> = {};
  for (let columnNumber = 1; columnNumber <= columnCount; columnNumber++) {
    const cellText = convertCellValueToText(row.getCell(columnNumber).value);
    if (cellText !== "") cellTextByColumnLetter[convertColumnNumberToLetter(columnNumber)] = cellText;
  }
  return cellTextByColumnLetter;
}

/** ExcelJS implementation of PairingImporter. */
export class ExcelColumnMappingPairingImporter implements PairingImporter {
  async readWorkbookOutline(fileBytes: Uint8Array): Promise<WorkbookOutline> {
    const workbook = await loadWorkbook(fileBytes);
    return {
      sheets: workbook.worksheets.map((worksheet) => {
        const columnCount = worksheet.columnCount;
        const leadingRows = Array.from({ length: Math.min(HEADER_DETECTION_ROW_COUNT, worksheet.rowCount) }, (_unused, rowIndex) => {
          const rowNumber = rowIndex + 1;
          return { rowNumber, cellTextByColumnLetter: readRowTexts(worksheet, rowNumber, columnCount) };
        });
        return {
          sheetName: worksheet.name,
          rowCount: worksheet.rowCount,
          columnCount,
          detectedHeaderRowNumber: detectHeaderRowNumber(leadingRows.map((row) => ({ rowNumber: row.rowNumber, cellTexts: Object.values(row.cellTextByColumnLetter) }))),
          previewRows: leadingRows.slice(0, OUTLINE_PREVIEW_ROW_COUNT),
        };
      }),
    };
  }

  async readMappedRows(fileBytes: Uint8Array, readRequest: PairingReadRequest): Promise<MappedSheetData> {
    const workbook = await loadWorkbook(fileBytes);
    const worksheet = workbook.getWorksheet(readRequest.sheetName);
    if (!worksheet) {
      throw new ApiError(400, "IMPORT_SHEET_NOT_FOUND", vi.importExport.sheetNotFound(readRequest.sheetName));
    }
    const mappedColumns = PAIRING_IMPORT_FIELDS.flatMap((fieldName) => {
      const columnLetter = readRequest.columnMapping[fieldName];
      const columnNumber = columnLetter ? convertColumnLetterToNumber(columnLetter) : null;
      return columnNumber ? [{ fieldName, columnNumber }] : [];
    });
    const dataRows: MappedSheetRow[] = [];
    const skippedRowNumbers: number[] = [];
    for (let rowNumber = readRequest.headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const cellTextByField: Partial<Record<PairingImportField, string>> = {};
      for (const { fieldName, columnNumber } of mappedColumns) {
        cellTextByField[fieldName] = convertCellValueToText(row.getCell(columnNumber).value);
      }
      const mappedRow = { rowNumber, cellTextByField };
      const hasAnyCell = Object.values(cellTextByField).some((cellText) => cellText !== "") || row.hasValues;
      if (isPairingDataRow(mappedRow)) dataRows.push(mappedRow);
      else if (hasAnyCell) skippedRowNumbers.push(rowNumber);
    }
    return {
      sheetName: worksheet.name,
      headerTextByColumnLetter: readRowTexts(worksheet, readRequest.headerRowNumber, worksheet.columnCount),
      dataRows,
      skippedRowNumbers,
    };
  }
}
