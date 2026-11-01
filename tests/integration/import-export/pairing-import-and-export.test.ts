// tests/integration/import-export/pairing-import-and-export.test.ts
// Phase 4 acceptance against PostgreSQL (AGENT_PROMPT.md §4 Phase 4):
//   - the anonymized Chess-Results fixture imports through manual column mapping (SRS-IMP-12);
//   - malformed workbooks produce errors naming sheet, row and column, and block confirmation (SRS-IMP-05..07);
//   - re-importing over boards with results needs the second confirmation and cancels results through the state
//     machine (SRS-IMP-09, CLAUDE.md §2); confirmation is all-or-nothing (SRS-IMP-10); imports are logged and the
//     mapping is saved (SRS-IMP-04, 11);
//   - an export of the tournament created by the real seed script contains only official results by default
//     (SRS-EXP-03), with a separate reconciliation file (SRS-EXP-04).

import { execSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { vi } from "@/i18n/vi";
import { prisma } from "@/server/database/prisma-client";
import { EXPORT_TABLE_HEADER_ROW_NUMBER } from "@/server/export/generic-result-workbook-exporter";
import { ResultXmlExporter } from "@/server/export/result-xml-exporter";
import { ApiError } from "@/server/http/api-error";
import { convertCellValueToText, ExcelColumnMappingPairingImporter } from "@/server/import/excel-column-mapping-importer";
import {
  buildImportPreview,
  confirmImport,
  storeUploadedWorkbook,
  type ImportSelection,
  type PairingImportDependencies,
} from "@/server/services/pairing-import-service";
import { buildResultExport } from "@/server/services/result-export-service";
import { applyResultTransition, type ResultActionRequest } from "@/server/services/result-lifecycle-service";
import { createTournament } from "@/server/services/tournament-service";
import { LocalDiskFileStorage } from "@/server/storage/file-storage";
import { createFixtureUser, wipeTestDatabase } from "../../helpers/test-database";
import { getVerifiedTestDatabaseUrl } from "../../helpers/test-database-url";
import { buildWorkbookBytes, GENERATED_SHEET_HEADER, GENERATED_SHEET_MAPPING } from "../../helpers/workbook-builders";

const CHESS_RESULTS_FIXTURE_PATH = path.resolve("tests/fixtures/chess-results-round-1-anonymized.xlsx");
/** Manual mapping for the Chess-Results layout: Bàn, White, LĐ, Điểm, Kết quả, Điểm, Black, LĐ. */
const CHESS_RESULTS_MAPPING = {
  boardNumber: "A",
  whiteName: "B",
  whiteClub: "C",
  whitePoints: "D",
  result: "E",
  blackPoints: "F",
  blackName: "G",
  blackClub: "H",
} as const;

let temporaryDirectory: string;
let dependencies: PairingImportDependencies;

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "uscc-import-"));
  dependencies = { pairingImporter: new ExcelColumnMappingPairingImporter(), fileStorage: new LocalDiskFileStorage(temporaryDirectory) };
});

afterAll(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

/**
 * Asserts an ApiError.
 *
 * @param operation - Promise expected to reject.
 * @param httpStatus - Status.
 * @param code - Code.
 * @returns The error, for further checks.
 */
async function expectApiError(operation: Promise<unknown>, httpStatus: number, code: string): Promise<ApiError> {
  const error = await operation.catch((caughtError: unknown) => caughtError);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ httpStatus, code });
  return error as ApiError;
}

describe("pairing import", () => {
  let tournamentId: string;
  let technicalUser: { id: string; username: string; role: Role };

  beforeEach(async () => {
    await wipeTestDatabase();
    technicalUser = await createFixtureUser("td_import", "TECHNICAL");
    const tournament = await prisma.$transaction((transaction) =>
      createTournament(
        { name: "Giải nhập thử", startDate: new Date("2026-11-01T00:00:00Z"), endDate: new Date("2026-11-02T00:00:00Z"), venue: null, organizer: null, roundsCount: 2, timezone: "Asia/Ho_Chi_Minh", primaryColor: null, secondaryColor: null },
        transaction,
      ),
    );
    tournamentId = tournament.id;
  });

  /**
   * Uploads bytes and returns a selection for round 1.
   *
   * @param fileBytes - Workbook bytes.
   * @param overrides - Selection fields to override.
   * @returns The selection.
   */
  async function uploadAndSelect(fileBytes: Uint8Array, overrides: Partial<ImportSelection> = {}): Promise<ImportSelection> {
    const uploadedWorkbook = await storeUploadedWorkbook(tournamentId, fileBytes, prisma, dependencies);
    const firstSheet = uploadedWorkbook.outline.sheets[0];
    return {
      uploadId: uploadedWorkbook.uploadId,
      roundNumber: 1,
      sheetName: firstSheet?.sheetName ?? "",
      headerRowNumber: firstSheet?.detectedHeaderRowNumber ?? 1,
      columnMapping: { ...GENERATED_SHEET_MAPPING },
      excludedRowNumbers: [],
      playerChoices: {},
      ...overrides,
    };
  }

  /**
   * Confirms an import in a transaction.
   *
   * @param importSelection - Selection.
   * @param isResultReplacementConfirmed - Second confirmation.
   * @returns Outcome.
   */
  function confirm(importSelection: ImportSelection, isResultReplacementConfirmed = false) {
    return prisma.$transaction(
      (transaction) => confirmImport(tournamentId, { ...importSelection, originalFilename: "cap-dau.xlsx", isResultReplacementConfirmed }, technicalUser, transaction, dependencies),
      { timeout: 60_000 },
    );
  }

  it("imports the Chess-Results fixture through manual mapping (SRS-IMP-12) and logs it", async () => {
    const fixtureBytes = new Uint8Array(await readFile(CHESS_RESULTS_FIXTURE_PATH));
    const uploadedWorkbook = await storeUploadedWorkbook(tournamentId, fixtureBytes, prisma, dependencies);
    expect(uploadedWorkbook.outline.sheets).toHaveLength(1);
    expect(uploadedWorkbook.outline.sheets[0]).toMatchObject({ sheetName: "Sheet1", detectedHeaderRowNumber: 6 });
    expect(uploadedWorkbook.savedMapping).toBeNull();

    const importSelection: ImportSelection = {
      uploadId: uploadedWorkbook.uploadId,
      roundNumber: 1,
      sheetName: "Sheet1",
      headerRowNumber: 6,
      columnMapping: { ...CHESS_RESULTS_MAPPING },
      excludedRowNumbers: [],
      playerChoices: {},
    };
    const preview = await buildImportPreview(tournamentId, importSelection, prisma, dependencies);
    expect(preview.rows).toHaveLength(40);
    expect(preview.issues.filter((issue) => issue.severity === "ERROR")).toEqual([]);
    expect(preview.skippedRowNumbers).toEqual([48, 49]);
    expect(preview.blockingReasons).toEqual([]);
    expect(preview.diffEntries.every((entry) => entry.kind === "ADDED")).toBe(true);
    // Nothing is written before confirmation (SRS-IMP-10).
    expect(await prisma.game.count()).toBe(0);

    const importOutcome = await confirm(importSelection);
    expect(importOutcome).toMatchObject({ roundNumber: 1, gameCount: 40 });
    expect(await prisma.player.count({ where: { tournamentId } })).toBe(80);
    const boardOne = await prisma.game.findFirstOrThrow({ where: { boardNumber: 1 }, include: { whitePlayer: true, blackPlayer: true, result: true } });
    expect(boardOne.whitePlayer).toMatchObject({ fullName: "Nguyễn Văn An Mẫu01", clubOrFederation: "UIT", swissManagerPlayerId: null });
    expect(boardOne.blackPlayer).toMatchObject({ clubOrFederation: "IUC" });
    // The result column is never imported: results go through player confirmation.
    expect(boardOne.result?.status).toBe("NONE");

    const pairingImport = await prisma.pairingImport.findFirstOrThrow();
    expect(pairingImport).toMatchObject({ originalFilename: "cap-dau.xlsx", fileSha256: uploadedWorkbook.uploadId, rowCount: 40, uploadedByUserId: technicalUser.id });
    expect(await dependencies.fileStorage.readFile(pairingImport.storageKey as string)).not.toBeNull();

    // SRS-IMP-04: the mapping is pre-filled on the next upload.
    const secondUpload = await storeUploadedWorkbook(tournamentId, fixtureBytes, prisma, dependencies);
    expect(secondUpload.savedMapping).toEqual({ sheetName: "Sheet1", headerRowNumber: 6, columnMapping: CHESS_RESULTS_MAPPING });
  });

  it("reports malformed rows with sheet, row and column, and blocks confirmation until they are excluded (SRS-IMP-05..07)", async () => {
    const malformedBytes = await buildWorkbookBytes([
      ["Danh sách cặp đấu"],
      GENERATED_SHEET_HEADER,
      [1, "201", "Kỳ Thủ Một", 0, "202", "Kỳ Thủ Hai", 0],
      [1, "203", "Kỳ Thủ Ba", 0, "204", "Kỳ Thủ Bốn", 0],
      ["x", "205", "Kỳ Thủ Năm", 0, "206", "Kỳ Thủ Sáu", 0],
      [4, "207", "", 0, "208", "Kỳ Thủ Tám", 0],
      [5, "209", "Kỳ Thủ Chín", "1.3", "210", "Kỳ Thủ Mười", 0],
      [6, "201", "Kỳ Thủ Một", 0, "211", "Kỳ Thủ Mười Một", 0],
      [7, "212", "Kỳ Thủ Mười Hai", 0, null, "BYE", null],
    ]);
    const importSelection = await uploadAndSelect(malformedBytes);
    expect(importSelection.headerRowNumber).toBe(2);
    const preview = await buildImportPreview(tournamentId, importSelection, prisma, dependencies);
    const errorMessages = preview.issues.filter((issue) => issue.severity === "ERROR").map((issue) => issue.messageVi);
    expect(errorMessages).toEqual([
      vi.importExport.rowError("Cặp đấu", 4, "A", vi.importExport.issueMessages.duplicateBoard(3)),
      vi.importExport.rowError("Cặp đấu", 5, "A", vi.importExport.issueMessages.boardNotPositiveInteger),
      vi.importExport.rowError("Cặp đấu", 6, "C", vi.importExport.issueMessages.missingRequiredValue),
      vi.importExport.rowError("Cặp đấu", 7, "D", vi.importExport.issueMessages.pointsInvalid),
      vi.importExport.rowError("Cặp đấu", 8, "C", vi.importExport.issueMessages.playerOnTwoBoards(3)),
    ]);
    expect(preview.rows.find((row) => row.rowNumber === 9)?.black).toBeNull();
    await expectApiError(confirm(importSelection), 409, "IMPORT_NOT_READY");
    expect(await prisma.game.count()).toBe(0);

    const importOutcome = await confirm({ ...importSelection, excludedRowNumbers: [4, 5, 6, 7, 8] });
    expect(importOutcome.gameCount).toBe(2);
    expect(await prisma.pairingImport.findFirstOrThrow()).toMatchObject({ rowCount: 2, excludedRows: [4, 5, 6, 7, 8] });
  });

  it("rejects non-xlsx files, oversized files, unknown uploads and incomplete mappings", async () => {
    await expectApiError(storeUploadedWorkbook(tournamentId, new TextEncoder().encode("Bàn,Trắng,Đen\n1,A,B"), prisma, dependencies), 400, "IMPORT_NOT_XLSX");
    const oversizedBytes = new Uint8Array(5 * 1024 * 1024 + 1);
    oversizedBytes.set([0x50, 0x4b, 0x03, 0x04]);
    await expectApiError(storeUploadedWorkbook(tournamentId, oversizedBytes, prisma, dependencies), 413, "IMPORT_FILE_TOO_LARGE");
    const fakeZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
    await expectApiError(storeUploadedWorkbook(tournamentId, fakeZip, prisma, dependencies), 400, "IMPORT_FILE_UNREADABLE");

    const selection = await uploadAndSelect(await buildWorkbookBytes([GENERATED_SHEET_HEADER, [1, "1", "A", 0, "2", "B", 0]]));
    await expectApiError(buildImportPreview(tournamentId, { ...selection, uploadId: "0".repeat(64) }, prisma, dependencies), 404, "IMPORT_UPLOAD_NOT_FOUND");
    await expectApiError(buildImportPreview(tournamentId, { ...selection, columnMapping: { boardNumber: "A", whiteName: "C" } }, prisma, dependencies), 400, "IMPORT_MAPPING_INVALID");
    await expectApiError(buildImportPreview(tournamentId, { ...selection, columnMapping: { boardNumber: "A", whiteName: "C", blackName: "C" } }, prisma, dependencies), 400, "IMPORT_MAPPING_INVALID");
    await expectApiError(buildImportPreview(tournamentId, { ...selection, sheetName: "Không có" }, prisma, dependencies), 400, "IMPORT_SHEET_NOT_FOUND");
  });

  it("requires a second confirmation to replace boards with results and cancels them through the state machine (SRS-IMP-09)", async () => {
    const firstFile = await buildWorkbookBytes([GENERATED_SHEET_HEADER, [1, "301", "Kỳ Thủ A", 0, "302", "Kỳ Thủ B", 0], [2, "303", "Kỳ Thủ C", 0, "304", "Kỳ Thủ D", 0]]);
    await confirm(await uploadAndSelect(firstFile));
    const boardOne = await prisma.game.findFirstOrThrow({ where: { boardNumber: 1 } });
    const whiteWinCode = await prisma.resultCode.findFirstOrThrow({ where: { tournamentId, code: "1-0" } });
    const act = (expectedVersion: number, actionRequest: ResultActionRequest) =>
      prisma.$transaction((transaction) => applyResultTransition({ gameId: boardOne.id, expectedVersion, actionRequest, actor: technicalUser }, transaction));
    await act(0, { type: "SUBMIT_RESULT", resultCodeId: whiteWinCode.id });
    await act(1, { type: "CONFIRM_BY_SIDE", side: "WHITE" });
    await act(2, { type: "CONFIRM_BY_SIDE", side: "BLACK" });

    // Board 1 gets a new Black player; board 2 is unchanged; board 3 is new.
    const secondFile = await buildWorkbookBytes([
      GENERATED_SHEET_HEADER,
      [1, "301", "Kỳ Thủ A", 0, "305", "Kỳ Thủ E", 0],
      [2, "303", "Kỳ Thủ C", 0, "304", "Kỳ Thủ D", 0],
      [3, "306", "Kỳ Thủ F", 0, "307", "Kỳ Thủ G", 0],
    ]);
    const secondSelection = await uploadAndSelect(secondFile);
    const preview = await buildImportPreview(tournamentId, secondSelection, prisma, dependencies);
    expect(preview.diffEntries.map((entry) => [entry.boardNumber, entry.kind, entry.hasResult])).toEqual([
      [1, "PLAYERS_CHANGED", true],
      [2, "UNCHANGED", false],
      [3, "ADDED", false],
    ]);
    expect(preview.requiresResultReplacementConfirmation).toBe(true);
    await expectApiError(confirm(secondSelection, false), 409, "IMPORT_REPLACEMENT_NOT_CONFIRMED");

    await confirm(secondSelection, true);
    const updatedBoardOne = await prisma.game.findFirstOrThrow({ where: { id: boardOne.id }, include: { blackPlayer: true, result: true } });
    expect(updatedBoardOne.blackPlayer?.fullName).toBe("Kỳ Thủ E");
    expect(updatedBoardOne.result).toMatchObject({ status: "NONE", version: 4 });
    const cancelEvent = await prisma.resultEvent.findFirstOrThrow({ where: { action: "CANCEL" } });
    expect(cancelEvent).toMatchObject({ actorUserId: technicalUser.id, reason: vi.importExport.cancelReasonForReimport("cap-dau.xlsx") });
  });

  it("writes nothing when the surrounding transaction fails (SRS-IMP-10)", async () => {
    const selection = await uploadAndSelect(await buildWorkbookBytes([GENERATED_SHEET_HEADER, [1, "401", "Kỳ Thủ H", 0, "402", "Kỳ Thủ I", 0]]));
    await expect(
      prisma.$transaction(async (transaction) => {
        await confirmImport(tournamentId, { ...selection, originalFilename: "x.xlsx", isResultReplacementConfirmed: false }, technicalUser, transaction, dependencies);
        throw new Error("forced failure after import");
      }),
    ).rejects.toThrow("forced failure after import");
    expect(await prisma.game.count()).toBe(0);
    expect(await prisma.player.count()).toBe(0);
    expect(await prisma.pairingImport.count()).toBe(0);
  });
});

describe("result export of the seeded tournament", () => {
  beforeEach(async () => {
    await wipeTestDatabase();
    // Run the real seed script against the test database.
    execSync("pnpm exec tsx prisma/seed.ts", { env: { ...process.env, DATABASE_URL: getVerifiedTestDatabaseUrl() }, stdio: "pipe" });
  });

  /**
   * Reads the data rows of an exported workbook.
   *
   * @param fileBytes - Exported file.
   * @returns [round, board, status label] per data row.
   */
  async function readExportRows(fileBytes: Uint8Array): Promise<string[][]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(fileBytes) as unknown as ArrayBuffer);
    const worksheet = workbook.worksheets[0] as ExcelJS.Worksheet;
    const rows: string[][] = [];
    for (let rowNumber = EXPORT_TABLE_HEADER_ROW_NUMBER + 1; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      rows.push([1, 2, 7, 9].map((columnNumber) => convertCellValueToText(row.getCell(columnNumber).value)));
    }
    return rows;
  }

  it("contains only OFFICIAL results by default and the rest in the reconciliation file (SRS-EXP-03, 04)", async () => {
    const tournament = await prisma.tournament.findFirstOrThrow({ where: { name: "Giải Demo USCC 2026" } });
    const recorder = await prisma.user.findUniqueOrThrow({ where: { username: "recorder_demo" } });
    const technical = await prisma.user.findUniqueOrThrow({ where: { username: "td_demo" } });
    const whiteWinCode = await prisma.resultCode.findFirstOrThrow({ where: { tournamentId: tournament.id, code: "1-0" } });
    const roundOneGames = await prisma.game.findMany({ where: { round: { tournamentId: tournament.id, roundNumber: 1 } }, orderBy: { boardNumber: "asc" } });
    const act = (gameIndex: number, expectedVersion: number, actionRequest: ResultActionRequest, actor = recorder) =>
      prisma.$transaction((transaction) => applyResultTransition({ gameId: (roundOneGames[gameIndex] as { id: string }).id, expectedVersion, actionRequest, actor }, transaction));

    await act(0, 0, { type: "SUBMIT_RESULT", resultCodeId: whiteWinCode.id });
    await act(0, 1, { type: "CONFIRM_BY_SIDE", side: "WHITE" });
    await act(0, 2, { type: "CONFIRM_BY_SIDE", side: "BLACK" });
    await act(1, 0, { type: "SUBMIT_RESULT", resultCodeId: whiteWinCode.id });
    await act(2, 0, { type: "SUBMIT_RESULT", resultCodeId: whiteWinCode.id });
    await act(2, 1, { type: "REJECT_BY_SIDE", side: "BLACK" });
    await act(3, 0, { type: "SUBMIT_RESULT", resultCodeId: whiteWinCode.id });
    await act(3, 1, { type: "REJECT_BY_SIDE", side: "WHITE" });
    await act(3, 2, { type: "APPROVE_EXCEPTION", resultCodeId: null, reason: "Trọng tài đã xem biên bản" }, technical);

    const officialExport = await buildResultExport({ tournamentId: tournament.id, roundNumber: null, content: "OFFICIAL" });
    expect(await readExportRows(officialExport.fileBytes)).toEqual([
      ["1", "1", "1-0", vi.resultStatus.OFFICIAL],
      ["1", "4", "1-0", vi.resultStatus.OFFICIAL],
    ]);

    const reconciliationExport = await buildResultExport({ tournamentId: tournament.id, roundNumber: 1, content: "RECONCILIATION" });
    expect(await readExportRows(reconciliationExport.fileBytes)).toEqual([
      ["1", "2", "1-0", vi.resultStatus.PENDING],
      ["1", "3", "1-0", vi.resultStatus.DISPUTED],
    ]);

    const roundTwoExport = await buildResultExport({ tournamentId: tournament.id, roundNumber: 2, content: "OFFICIAL" });
    expect(await readExportRows(roundTwoExport.fileBytes)).toEqual([[vi.importExport.workbook.noRows, "", "", ""]]);
    await expectApiError(buildResultExport({ tournamentId: tournament.id, roundNumber: 9, content: "OFFICIAL" }), 404, "ROUND_NOT_FOUND");
  });

  it("names the winner in the Excel and XML exports, and the XML holds only OFFICIAL results (FR-09, OI-02)", async () => {
    const tournament = await prisma.tournament.findFirstOrThrow({ where: { name: "Giải Demo USCC 2026" } });
    const recorder = await prisma.user.findUniqueOrThrow({ where: { username: "recorder_demo" } });
    const blackWinCode = await prisma.resultCode.findFirstOrThrow({ where: { tournamentId: tournament.id, code: "0-1" } });
    const roundOneGames = await prisma.game.findMany({
      where: { round: { tournamentId: tournament.id, roundNumber: 1 } },
      include: { blackPlayer: true },
      orderBy: { boardNumber: "asc" },
    });
    const [officialGame, pendingGame] = roundOneGames as [(typeof roundOneGames)[number], (typeof roundOneGames)[number]];
    const act = (gameId: string, expectedVersion: number, actionRequest: ResultActionRequest) =>
      prisma.$transaction((transaction) => applyResultTransition({ gameId, expectedVersion, actionRequest, actor: recorder }, transaction));
    await act(officialGame.id, 0, { type: "SUBMIT_RESULT", resultCodeId: blackWinCode.id });
    await act(officialGame.id, 1, { type: "CONFIRM_BY_SIDE", side: "WHITE" });
    await act(officialGame.id, 2, { type: "CONFIRM_BY_SIDE", side: "BLACK" });
    await act(pendingGame.id, 0, { type: "SUBMIT_RESULT", resultCodeId: blackWinCode.id });
    const blackPlayer = officialGame.blackPlayer as NonNullable<typeof officialGame.blackPlayer>;

    const excelExport = await buildResultExport({ tournamentId: tournament.id, roundNumber: 1, content: "OFFICIAL" });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(excelExport.fileBytes) as unknown as ArrayBuffer);
    const worksheet = workbook.worksheets[0] as ExcelJS.Worksheet;
    expect(convertCellValueToText(worksheet.getRow(EXPORT_TABLE_HEADER_ROW_NUMBER).getCell(10).value)).toBe(vi.importExport.workbook.columns.winner);
    expect(convertCellValueToText(worksheet.getRow(EXPORT_TABLE_HEADER_ROW_NUMBER + 1).getCell(10).value)).toBe(blackPlayer.fullName);

    const xmlExport = await buildResultExport({ tournamentId: tournament.id, roundNumber: 1, content: "OFFICIAL" }, new ResultXmlExporter());
    const xmlText = new TextDecoder().decode(xmlExport.fileBytes);
    expect(xmlExport.fileName.endsWith(".xml")).toBe(true);
    expect(xmlText.match(/<Game /g)).toHaveLength(1);
    expect(xmlText).toContain(`<Game board="${officialGame.boardNumber}" status="OFFICIAL" outcome="BLACK_WINS">`);
    expect(xmlText).toContain(`<Winner side="BLACK"`);
    expect(xmlText).toContain(`name="${blackPlayer.fullName}"`);
    expect(xmlText).not.toContain(`board="${pendingGame.boardNumber}"`);
  });
});
