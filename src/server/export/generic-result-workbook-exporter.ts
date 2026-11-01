// src/server/export/generic-result-workbook-exporter.ts
// The v1 ResultExporter: a generic .xlsx (SRS-EXP-02) with a header block (tournament, scope, content, generation
// time, and a note that the layout is provisional) followed by one row per game: round, board, White ID and name,
// Black ID and name, result (Swiss-Manager value), status, winner. Laid out for fast manual entry into Swiss-Manager
// until its re-import format is confirmed (OI-02, RISK-01). All labels come from vi.ts.

import ExcelJS from "exceljs";
import { vi } from "@/i18n/vi";
import type { ExportedFile, ResultExportData, ResultExporter } from "@/server/export/result-exporter";

/** Row where the column titles go; rows 1–5 hold the header block. */
export const EXPORT_TABLE_HEADER_ROW_NUMBER = 7;

/**
 * Makes a file name safe on every OS: ASCII letters, digits and dashes only.
 *
 * @param text - Any text.
 * @returns Slug.
 */
export function toFileNameSlug(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/gi, "d")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 60) || "giai"
  );
}

/** Generic workbook implementation of ResultExporter. */
export class GenericResultWorkbookExporter implements ResultExporter {
  async buildExportFile(exportData: ResultExportData): Promise<ExportedFile> {
    const labels = vi.importExport.workbook;
    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet(exportData.content === "OFFICIAL" ? labels.officialSheetName : labels.reconciliationSheetName);

    const headerBlock: [string, string][] = [
      [labels.tournamentLabel, exportData.tournamentName],
      [labels.scopeLabel, exportData.scopeLabel],
      [labels.contentLabel, exportData.content === "OFFICIAL" ? labels.officialContent : labels.reconciliationContent],
      [labels.generatedAtLabel, exportData.generatedAtText],
      ["", vi.importExport.exportFormatNote],
    ];
    headerBlock.forEach(([label, value], rowIndex) => {
      const headerRow = worksheet.getRow(rowIndex + 1);
      headerRow.getCell(1).value = label;
      headerRow.getCell(1).font = { bold: true };
      headerRow.getCell(2).value = value;
    });

    const columns = labels.columns;
    const columnTitles = [columns.round, columns.board, columns.whiteId, columns.whiteName, columns.blackId, columns.blackName, columns.result, columns.resultLabel, columns.status, columns.winner];
    const titleRow = worksheet.getRow(EXPORT_TABLE_HEADER_ROW_NUMBER);
    titleRow.values = columnTitles;
    titleRow.font = { bold: true };
    titleRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
      cell.border = { bottom: { style: "thin" } };
    });

    exportData.rows.forEach((gameRow, rowIndex) => {
      worksheet.getRow(EXPORT_TABLE_HEADER_ROW_NUMBER + 1 + rowIndex).values = [
        gameRow.roundNumber,
        gameRow.boardNumber,
        gameRow.whitePlayerId ?? "",
        gameRow.whiteName,
        gameRow.blackPlayerId ?? "",
        gameRow.blackName ?? vi.importExport.byeLabel,
        gameRow.swissManagerResultValue ?? "",
        gameRow.resultLabelVi ?? "",
        vi.resultStatus[gameRow.status],
        gameRow.winnerName ?? vi.gameOutcome[gameRow.outcome],
      ];
    });
    if (exportData.rows.length === 0) {
      worksheet.getRow(EXPORT_TABLE_HEADER_ROW_NUMBER + 1).getCell(1).value = labels.noRows;
    }
    worksheet.columns.forEach((column, columnIndex) => {
      column.width = [8, 6, 14, 30, 14, 30, 22, 26, 18, 30][columnIndex] ?? 14;
    });
    worksheet.views = [{ state: "frozen", ySplit: EXPORT_TABLE_HEADER_ROW_NUMBER }];

    const fileBytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    const contentSuffix = exportData.content === "OFFICIAL" ? "ket-qua-chinh-thuc" : "doi-soat";
    return {
      fileBytes,
      fileName: `${toFileNameSlug(exportData.tournamentName)}-${toFileNameSlug(exportData.scopeLabel)}-${contentSuffix}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }
}
