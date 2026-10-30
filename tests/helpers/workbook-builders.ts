// tests/helpers/workbook-builders.ts
// Builds small .xlsx workbooks in memory for import tests, including deliberately malformed ones
// (TEST_AGENT_PROMPT: malformed fixtures). Player names are fictional.

import ExcelJS from "exceljs";

/** One cell value as written to the sheet. */
export type FixtureCellValue = string | number | null;

/**
 * Writes rows to a one-sheet workbook.
 *
 * @param rows - Rows from row 1 down; null leaves a cell empty.
 * @param sheetName - Sheet name.
 * @returns The .xlsx bytes.
 */
export async function buildWorkbookBytes(rows: FixtureCellValue[][], sheetName = "Cặp đấu"): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);
  rows.forEach((rowValues, rowIndex) => {
    rowValues.forEach((cellValue, columnIndex) => {
      if (cellValue !== null) worksheet.getRow(rowIndex + 1).getCell(columnIndex + 1).value = cellValue;
    });
  });
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

/** Header used by the generated pairing sheets: Board, White ID, White, Points, Black ID, Black, Points. */
export const GENERATED_SHEET_HEADER: FixtureCellValue[] = ["Bàn", "Mã Trắng", "Trắng", "Điểm", "Mã Đen", "Đen", "Điểm"];

/** Column mapping matching GENERATED_SHEET_HEADER. */
export const GENERATED_SHEET_MAPPING = {
  boardNumber: "A",
  whitePlayerId: "B",
  whiteName: "C",
  whitePoints: "D",
  blackPlayerId: "E",
  blackName: "F",
  blackPoints: "G",
} as const;
