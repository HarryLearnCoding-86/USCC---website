// src/server/export/result-xml-exporter.ts
// ResultExporter that writes results as UTF-8 XML, for re-entering results into Swiss-Manager (FR-09, SRS-EXP-05).
// PROVISIONAL (OI-02): Swiss-Manager's XML import layout has not been confirmed, so this is a documented, neutral
// layout keyed by Swiss-Manager player IDs — tournament → round → game with both players, scores, the result value
// and the winner. When a real Swiss-Manager XML file is available, only this file changes.
// Written by hand rather than with an XML library: the structure is small and fixed, and every value is escaped.

import type { ExportGameRow, ExportedFile, ResultExportData, ResultExporter } from "@/server/export/result-exporter";
import { toFileNameSlug } from "@/server/export/generic-result-workbook-exporter";
import { selectWinningSide } from "@/server/domain/game-winner";

/** Version of this layout, written into the file so a later importer can tell layouts apart. */
export const RESULT_XML_FORMAT_VERSION = "1";

/**
 * Escapes text for an XML attribute or element. Also drops control characters XML 1.0 forbids.
 *
 * @param text - Any text.
 * @returns Escaped text.
 */
export function escapeXmlText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Builds ` name="value"` pairs, skipping null values so a missing ID is absent rather than empty.
 *
 * @param attributes - Attribute names and values.
 * @returns The attribute text, with a leading space per attribute.
 */
function formatXmlAttributes(attributes: Record<string, string | number | null>): string {
  return Object.entries(attributes)
    .filter((attribute): attribute is [string, string | number] => attribute[1] !== null)
    .map(([attributeName, attributeValue]) => ` ${attributeName}="${escapeXmlText(String(attributeValue))}"`)
    .join("");
}

/**
 * Writes one game. Scores keep ½ as 0.5 (CLAUDE.md §3), which machines read without a special glyph.
 *
 * @param gameRow - The game.
 * @returns The <Game> element, indented for a round.
 */
function formatGameElement(gameRow: ExportGameRow): string {
  const winningSide = selectWinningSide(gameRow.outcome);
  const lines = [
    `    <Game${formatXmlAttributes({ board: gameRow.boardNumber, status: gameRow.status, outcome: gameRow.outcome })}>`,
    `      <White${formatXmlAttributes({ playerId: gameRow.whitePlayerId, name: gameRow.whiteName, score: gameRow.whiteScore })}/>`,
    gameRow.blackName === null
      ? "      <Black bye=\"true\"/>"
      : `      <Black${formatXmlAttributes({ playerId: gameRow.blackPlayerId, name: gameRow.blackName, score: gameRow.blackScore })}/>`,
    `      <Result${formatXmlAttributes({ swissManagerValue: gameRow.swissManagerResultValue, label: gameRow.resultLabelVi })}/>`,
  ];
  if (winningSide !== null) {
    lines.push(`      <Winner${formatXmlAttributes({ side: winningSide, playerId: gameRow.winnerPlayerId, name: gameRow.winnerName })}/>`);
  }
  lines.push("    </Game>");
  return lines.join("\n");
}

/** XML implementation of ResultExporter. */
export class ResultXmlExporter implements ResultExporter {
  async buildExportFile(exportData: ResultExportData): Promise<ExportedFile> {
    const roundNumbers = [...new Set(exportData.rows.map((gameRow) => gameRow.roundNumber))].sort((first, second) => first - second);
    const roundElements = roundNumbers.map((roundNumber) =>
      [
        `  <Round number="${roundNumber}">`,
        ...exportData.rows.filter((gameRow) => gameRow.roundNumber === roundNumber).map(formatGameElement),
        "  </Round>",
      ].join("\n"),
    );
    const xmlText = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<!-- USCC Referee Results export. Provisional layout until the Swiss-Manager import format is confirmed (OI-02). -->",
      `<ResultExport${formatXmlAttributes({
        formatVersion: RESULT_XML_FORMAT_VERSION,
        tournament: exportData.tournamentName,
        scope: exportData.scopeLabel,
        content: exportData.content,
        generatedAt: exportData.generatedAtIso,
      })}>`,
      ...roundElements,
      "</ResultExport>",
      "",
    ].join("\n");

    const contentSuffix = exportData.content === "OFFICIAL" ? "ket-qua-chinh-thuc" : "doi-soat";
    return {
      fileBytes: new TextEncoder().encode(xmlText),
      fileName: `${toFileNameSlug(exportData.tournamentName)}-${toFileNameSlug(exportData.scopeLabel)}-${contentSuffix}.xml`,
      contentType: "application/xml; charset=utf-8",
    };
  }
}
