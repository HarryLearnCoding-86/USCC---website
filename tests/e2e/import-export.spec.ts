// tests/e2e/import-export.spec.ts
// Phase 4 acceptance through the UI on the desktop viewport (AGENT_PROMPT.md §4 Phase 4):
//   - the TD imports the anonymized Chess-Results fixture with the wizard, mapping every column by hand;
//   - the TD downloads the export, which contains only the official result by default (SRS-EXP-03).

import path from "node:path";
import ExcelJS from "exceljs";
import { expect, test } from "@playwright/test";
import { vi } from "../../src/i18n/vi";
import { createE2eTournament, E2E_ACCOUNTS, sendE2eMutation, signInThroughApi } from "./helpers/e2e-api-helpers";

test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "Import and export are laptop screens");

const CHESS_RESULTS_FIXTURE_PATH = path.resolve("tests/fixtures/chess-results-round-1-anonymized.xlsx");

test("TD imports the Chess-Results fixture through manual mapping, then exports official results only", async ({ page, context }) => {
  test.setTimeout(150_000);
  await signInThroughApi(context.request, E2E_ACCOUNTS.technical);
  const tournament = await createE2eTournament(context.request, 0);

  // Steps 1–2: upload, then check the detected header row.
  await page.goto(`/tournaments/${tournament.tournamentId}/import`);
  await page.locator('input[name="workbook"]').setInputFiles(CHESS_RESULTS_FIXTURE_PATH);
  await page.getByRole("button", { name: vi.importExport.uploadButton }).click();
  await expect(page.getByText(vi.importExport.detectedHeaderNote(6))).toBeVisible();
  await page.getByRole("button", { name: vi.importExport.nextButton }).click();

  // Step 3: map every column by hand (SRS-IMP-12: no layout is assumed).
  const manualMapping: [string, string][] = [
    ["boardNumber", "A"], ["whiteName", "B"], ["whiteClub", "C"], ["whitePoints", "D"],
    ["result", "E"], ["blackPoints", "F"], ["blackName", "G"], ["blackClub", "H"],
  ];
  for (const [fieldName, columnLetter] of manualMapping) {
    await page.getByLabel(vi.importExport.fieldLabels[fieldName] as string, { exact: true }).selectOption(columnLetter);
  }
  await page.getByRole("button", { name: vi.importExport.previewButton }).click();

  // Step 4: preview without errors; the footer rows are skipped.
  await expect(page.getByTestId("import-preview-summary")).toHaveText(vi.importExport.previewSummary(40, 0));
  await expect(page.getByText(vi.importExport.skippedRowsNote("48, 49"))).toBeVisible();
  await expect(page.getByTestId("import-row-7")).toContainText("Nguyễn Văn An Mẫu01");

  // Step 5: confirm.
  await page.getByRole("button", { name: vi.importExport.confirmButton }).click();
  await expect(page.getByTestId("import-done")).toContainText(vi.importExport.importSuccess(40, 1));
  await page.getByRole("link", { name: vi.importExport.viewRoundLink }).click();
  await expect(page.getByTestId("game-card-40")).toBeVisible();

  // Make board 1 official and board 2 pending through the API.
  const gamesResponse = await context.request.get(`/api/tournaments/${tournament.tournamentId}/rounds/1/games`);
  const { games } = (await gamesResponse.json()) as { games: { gameId: string; boardNumber: number }[] };
  const gameIdByBoard = new Map(games.map((game) => [game.boardNumber, game.gameId]));
  const whiteWinCodeId = tournament.resultCodeIdByCode["1-0"];
  await sendE2eMutation(context.request, "POST", `/api/games/${gameIdByBoard.get(1)}/result`, { resultCodeId: whiteWinCodeId, version: 0 });
  await sendE2eMutation(context.request, "POST", `/api/games/${gameIdByBoard.get(1)}/confirm`, { side: "WHITE", decision: "CONFIRM", version: 1 });
  await sendE2eMutation(context.request, "POST", `/api/games/${gameIdByBoard.get(1)}/confirm`, { side: "BLACK", decision: "CONFIRM", version: 2 });
  await sendE2eMutation(context.request, "POST", `/api/games/${gameIdByBoard.get(2)}/result`, { resultCodeId: whiteWinCodeId, version: 0 });

  // Export with the default options.
  await page.goto(`/tournaments/${tournament.tournamentId}/export`);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: vi.importExport.exportDownloadButton }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/ket-qua-chinh-thuc\.xlsx$/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await download.path());
  const worksheet = workbook.worksheets[0] as ExcelJS.Worksheet;
  const dataRows: string[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 7) dataRows.push(`${row.getCell(2).text}|${row.getCell(7).text}|${row.getCell(9).text}`);
  });
  expect(dataRows).toEqual([`1|1-0|${vi.resultStatus.OFFICIAL}`]);
});
