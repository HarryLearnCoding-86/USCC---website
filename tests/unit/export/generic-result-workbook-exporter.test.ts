// tests/unit/export/generic-result-workbook-exporter.test.ts
// Unit tests for the v1 export layout (SRS-EXP-02): header block, column titles, one row per game, byes,
// winner column, a safe file name. The workbook is read back with ExcelJS, as the TD's spreadsheet program would.

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { vi } from "@/i18n/vi";
import { EXPORT_TABLE_HEADER_ROW_NUMBER, GenericResultWorkbookExporter } from "@/server/export/generic-result-workbook-exporter";
import { convertCellValueToText } from "@/server/import/excel-column-mapping-importer";

/**
 * Reads a row as texts.
 *
 * @param worksheet - Sheet.
 * @param rowNumber - Row.
 * @returns Cell texts of columns A–J.
 */
function readRowTexts(worksheet: ExcelJS.Worksheet, rowNumber: number): string[] {
  return Array.from({ length: 10 }, (_unused, columnIndex) => convertCellValueToText(worksheet.getRow(rowNumber).getCell(columnIndex + 1).value));
}

describe("GenericResultWorkbookExporter", () => {
  it("writes the header block and one row per game", async () => {
    const exportedFile = await new GenericResultWorkbookExporter().buildExportFile({
      tournamentName: "Giải Thử Nghiệm 2026",
      scopeLabel: "Vòng 1",
      content: "OFFICIAL",
      generatedAtText: "30/10/2026 20:05",
      generatedAtIso: "2026-10-30T13:05:00.000Z",
      rows: [
        { roundNumber: 1, boardNumber: 1, whitePlayerId: "101", whiteName: "Trắng A", blackPlayerId: "102", blackName: "Đen B", swissManagerResultValue: "1-0", resultLabelVi: "Trắng thắng",
          whiteScore: 1, blackScore: 0, outcome: "WHITE_WINS", winnerPlayerId: "101", winnerName: "Trắng A", status: "OFFICIAL" },
        { roundNumber: 1, boardNumber: 2, whitePlayerId: null, whiteName: "Trắng C", blackPlayerId: null, blackName: null, swissManagerResultValue: "+", resultLabelVi: "Miễn đấu (1 điểm)",
          whiteScore: 1, blackScore: 0, outcome: "BYE", winnerPlayerId: null, winnerName: null, status: "OFFICIAL" },
      ],
    });
    expect(exportedFile.fileName).toBe("giai-thu-nghiem-2026-vong-1-ket-qua-chinh-thuc.xlsx");
    expect(exportedFile.contentType).toContain("spreadsheetml");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(exportedFile.fileBytes) as unknown as ArrayBuffer);
    const worksheet = workbook.worksheets[0] as ExcelJS.Worksheet;
    expect(worksheet.name).toBe(vi.importExport.workbook.officialSheetName);
    expect(readRowTexts(worksheet, 1).slice(0, 2)).toEqual([vi.importExport.workbook.tournamentLabel, "Giải Thử Nghiệm 2026"]);
    expect(readRowTexts(worksheet, 2).slice(0, 2)).toEqual([vi.importExport.workbook.scopeLabel, "Vòng 1"]);
    expect(readRowTexts(worksheet, 4).slice(0, 2)).toEqual([vi.importExport.workbook.generatedAtLabel, "30/10/2026 20:05"]);
    const columns = vi.importExport.workbook.columns;
    expect(readRowTexts(worksheet, EXPORT_TABLE_HEADER_ROW_NUMBER)).toEqual([
      columns.round, columns.board, columns.whiteId, columns.whiteName, columns.blackId, columns.blackName, columns.result, columns.resultLabel, columns.status, columns.winner,
    ]);
    expect(readRowTexts(worksheet, EXPORT_TABLE_HEADER_ROW_NUMBER + 1)).toEqual(["1", "1", "101", "Trắng A", "102", "Đen B", "1-0", "Trắng thắng", vi.resultStatus.OFFICIAL, "Trắng A"]);
    expect(readRowTexts(worksheet, EXPORT_TABLE_HEADER_ROW_NUMBER + 2)).toEqual(["1", "2", "", "Trắng C", "", vi.importExport.byeLabel, "+", "Miễn đấu (1 điểm)", vi.resultStatus.OFFICIAL, vi.gameOutcome.BYE]);
  });

  it("says so when there are no rows, and names the reconciliation file differently", async () => {
    const exportedFile = await new GenericResultWorkbookExporter().buildExportFile({
      tournamentName: "Giải", scopeLabel: "Toàn giải", content: "RECONCILIATION", generatedAtText: "", generatedAtIso: "", rows: [],
    });
    expect(exportedFile.fileName).toBe("giai-toan-giai-doi-soat.xlsx");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(exportedFile.fileBytes) as unknown as ArrayBuffer);
    const worksheet = workbook.worksheets[0] as ExcelJS.Worksheet;
    expect(worksheet.name).toBe(vi.importExport.workbook.reconciliationSheetName);
    expect(readRowTexts(worksheet, EXPORT_TABLE_HEADER_ROW_NUMBER + 1)[0]).toBe(vi.importExport.workbook.noRows);
  });
});

describe("convertCellValueToText", () => {
  it("normalises the shapes ExcelJS returns", () => {
    expect(convertCellValueToText(null)).toBe("");
    expect(convertCellValueToText(7)).toBe("7");
    expect(convertCellValueToText(1.5)).toBe("1.5");
    expect(convertCellValueToText("  Tên  ")).toBe("Tên");
    expect(convertCellValueToText({ richText: [{ text: "Nguyễn " }, { text: "An" }] })).toBe("Nguyễn An");
    expect(convertCellValueToText({ formula: "A1+1", result: 3 } as ExcelJS.CellValue)).toBe("3");
    expect(convertCellValueToText({ text: "link", hyperlink: "https://example.test" })).toBe("link");
  });
});
