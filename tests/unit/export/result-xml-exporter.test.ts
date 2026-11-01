// tests/unit/export/result-xml-exporter.test.ts
// Unit tests for the provisional XML export (FR-09, OI-02): structure grouped by round, the winner element,
// byes and draws without a winner, escaping of names, and a parseable UTF-8 document.

import { describe, expect, it } from "vitest";
import type { ExportGameRow } from "@/server/export/result-exporter";
import { escapeXmlText, RESULT_XML_FORMAT_VERSION, ResultXmlExporter } from "@/server/export/result-xml-exporter";

/** A finished game row with sensible defaults. */
function buildGameRow(overrides: Partial<ExportGameRow>): ExportGameRow {
  return {
    roundNumber: 1,
    boardNumber: 1,
    whitePlayerId: "101",
    whiteName: "Trắng A",
    blackPlayerId: "102",
    blackName: "Đen B",
    swissManagerResultValue: "1-0",
    resultLabelVi: "Trắng thắng",
    whiteScore: 1,
    blackScore: 0,
    outcome: "WHITE_WINS",
    winnerPlayerId: "101",
    winnerName: "Trắng A",
    status: "OFFICIAL",
    ...overrides,
  };
}

/**
 * Builds the XML text for some rows.
 *
 * @param rows - Game rows.
 * @returns The file name and decoded XML.
 */
async function exportRows(rows: ExportGameRow[]): Promise<{ fileName: string; contentType: string; xmlText: string }> {
  const exportedFile = await new ResultXmlExporter().buildExportFile({
    tournamentName: "Giải Thử Nghiệm 2026",
    scopeLabel: "Toàn giải",
    content: "OFFICIAL",
    generatedAtText: "30/10/2026 20:05",
    generatedAtIso: "2026-10-30T13:05:00.000Z",
    rows,
  });
  return { fileName: exportedFile.fileName, contentType: exportedFile.contentType, xmlText: new TextDecoder().decode(exportedFile.fileBytes) };
}

describe("ResultXmlExporter", () => {
  it("writes a header, rounds in order and the winner of each decided game", async () => {
    const { fileName, contentType, xmlText } = await exportRows([
      buildGameRow({ roundNumber: 2, boardNumber: 1, outcome: "BLACK_WINS", whiteScore: 0, blackScore: 1, swissManagerResultValue: "0-1", winnerPlayerId: "102", winnerName: "Đen B" }),
      buildGameRow({}),
    ]);
    expect(fileName).toBe("giai-thu-nghiem-2026-toan-giai-ket-qua-chinh-thuc.xml");
    expect(contentType).toContain("application/xml");
    expect(xmlText.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xmlText).toContain(
      `<ResultExport formatVersion="${RESULT_XML_FORMAT_VERSION}" tournament="Giải Thử Nghiệm 2026" scope="Toàn giải" content="OFFICIAL" generatedAt="2026-10-30T13:05:00.000Z">`,
    );
    expect(xmlText.indexOf('<Round number="1">')).toBeLessThan(xmlText.indexOf('<Round number="2">'));
    expect(xmlText).toContain('<White playerId="101" name="Trắng A" score="1"/>');
    expect(xmlText).toContain('<Winner side="WHITE" playerId="101" name="Trắng A"/>');
    expect(xmlText).toContain('<Winner side="BLACK" playerId="102" name="Đen B"/>');
    expect(xmlText.trimEnd().endsWith("</ResultExport>")).toBe(true);
  });

  it("has no winner for draws, byes and double forfeits, and keeps ½ as 0.5", async () => {
    const { xmlText } = await exportRows([
      buildGameRow({ boardNumber: 1, outcome: "DRAW", whiteScore: 0.5, blackScore: 0.5, swissManagerResultValue: "½-½", winnerPlayerId: null, winnerName: null }),
      buildGameRow({ boardNumber: 2, outcome: "BYE", blackPlayerId: null, blackName: null, blackScore: 0, winnerPlayerId: null, winnerName: null }),
      buildGameRow({ boardNumber: 3, outcome: "NO_WINNER", whiteScore: 0, blackScore: 0, winnerPlayerId: null, winnerName: null }),
    ]);
    expect(xmlText).not.toContain("<Winner");
    expect(xmlText).toContain('score="0.5"');
    expect(xmlText).toContain('<Black bye="true"/>');
    expect(xmlText).toContain('outcome="NO_WINNER"');
  });

  it("escapes names and leaves out missing player IDs", async () => {
    const { xmlText } = await exportRows([buildGameRow({ whitePlayerId: null, whiteName: 'A & "B" <C>', winnerPlayerId: null, winnerName: 'A & "B" <C>' })]);
    expect(xmlText).toContain('<White name="A &amp; &quot;B&quot; &lt;C&gt;" score="1"/>');
    expect(xmlText).not.toContain('playerId=""');
  });

  it("writes an empty but valid document when there are no rows", async () => {
    const { xmlText } = await exportRows([]);
    expect(xmlText).not.toContain("<Round");
    expect(xmlText).toMatch(/<ResultExport [^>]*>\n<\/ResultExport>/);
  });
});

describe("escapeXmlText", () => {
  it("escapes markup characters and drops control characters", () => {
    expect(escapeXmlText(`<a href='x'>&</a>`)).toBe("&lt;a href=&apos;x&apos;&gt;&amp;&lt;/a&gt;");
    expect(escapeXmlText("Tên\u0001")).toBe("Tên");
  });
});
