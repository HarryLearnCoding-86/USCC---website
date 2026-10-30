// src/server/services/pairing-import-service.ts
// The pairing import wizard's server side (SRS-IMP-01..11, BR-02), in three calls:
//   1. storeUploadedWorkbook — size/type checks, store the file, return the sheet outline and saved mapping;
//   2. buildImportPreview    — read through the TD's mapping, validate, resolve players, diff the round; writes nothing;
//   3. confirmImport         — re-run the preview inside the transaction and apply it all-or-nothing (SRS-IMP-10),
//      cancelling (through the state machine) results of boards whose players change, log the import (SRS-IMP-11)
//      and save the mapping (SRS-IMP-04).
// The file stays the single source of truth between calls: the preview is recomputed on confirm, so what is written
// is exactly what the latest validation accepted.

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { vi } from "@/i18n/vi";
import type { SignedInUser } from "@/server/auth/session-store";
import type { DatabaseClient } from "@/server/database/database-client";
import { prisma } from "@/server/database/prisma-client";
import {
  buildPlayerChoiceKey,
  computeRoundDiff,
  convertColumnLetterToNumber,
  parseImportedRows,
  REQUIRED_MAPPED_FIELDS,
  resolveImportedPlayers,
  type ImportCellIssue,
  type ImportedRow,
  type ImportedSide,
  type ImportPlayerTarget,
  type IncomingBoard,
  type PairingColumnMapping,
  type PlayerChoices,
  type RoundDiffEntry,
} from "@/server/domain/pairing-import-rules";
import { ApiError } from "@/server/http/api-error";
import { ExcelColumnMappingPairingImporter } from "@/server/import/excel-column-mapping-importer";
import type { PairingImporter, WorkbookOutline } from "@/server/import/pairing-importer";
import { notifyTournamentChanged } from "@/server/services/change-notifier";
import { applyResultTransition } from "@/server/services/result-lifecycle-service";
import { getFileStorage, type FileStorage } from "@/server/storage/file-storage";

/** SRS-IMP-01: maximum upload size. */
export const MAXIMUM_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
/** .xlsx files are ZIP archives and start with "PK\x03\x04". */
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
/** Upload IDs are SHA-256 hex digests; anything else is rejected before touching storage. */
const UPLOAD_ID_PATTERN = /^[0-9a-f]{64}$/;

/** Dependencies, injectable for tests. */
export interface PairingImportDependencies {
  pairingImporter: PairingImporter;
  fileStorage: FileStorage;
}

/**
 * Default dependencies: the ExcelJS importer and app storage.
 *
 * @returns Dependencies.
 */
function getDefaultDependencies(): PairingImportDependencies {
  return { pairingImporter: new ExcelColumnMappingPairingImporter(), fileStorage: getFileStorage() };
}

/** Saved mapping for a tournament (SRS-IMP-04). */
export interface SavedImportMapping {
  sheetName: string | null;
  headerRowNumber: number | null;
  columnMapping: PairingColumnMapping;
}

/** Result of step 1. */
export interface UploadedWorkbook {
  uploadId: string;
  outline: WorkbookOutline;
  savedMapping: SavedImportMapping | null;
}

/** The TD's choices for steps 2–4. */
export interface ImportSelection {
  uploadId: string;
  roundNumber: number;
  sheetName: string;
  headerRowNumber: number;
  columnMapping: PairingColumnMapping;
  excludedRowNumbers: number[];
  playerChoices: PlayerChoices;
}

/** One issue ready for display, with the sheet/row/column message of SRS-IMP-05. */
export interface PreviewIssue extends ImportCellIssue {
  columnLetter: string;
  messageVi: string;
}

/** One previewed row. */
export interface PreviewRow {
  rowNumber: number;
  boardNumber: number | null;
  white: ImportedSide;
  black: ImportedSide | null;
  resultText: string | null;
  isExcluded: boolean;
}

/** Result of step 4. */
export interface ImportPreview {
  sheetName: string;
  roundNumber: number;
  rows: PreviewRow[];
  issues: PreviewIssue[];
  skippedRowNumbers: number[];
  diffEntries: RoundDiffEntry[];
  requiresResultReplacementConfirmation: boolean;
  /** Vietnamese reasons the import cannot be confirmed yet; empty when it can. */
  blockingReasons: string[];
  /** Resolved targets of non-excluded rows (internal; used by confirm). */
  targetsByChoiceKey: Map<string, ImportPlayerTarget>;
}

/**
 * Step 1: validates and stores an uploaded workbook.
 *
 * @param tournamentId - Tournament ID.
 * @param fileBytes - Uploaded bytes.
 * @param database - Client (reads only).
 * @param dependencies - Importer and storage.
 * @returns Upload ID (content hash), sheet outline and the saved mapping.
 * @throws ApiError 404 TOURNAMENT_NOT_FOUND, 413 IMPORT_FILE_TOO_LARGE, 400 IMPORT_NOT_XLSX / IMPORT_FILE_UNREADABLE.
 */
export async function storeUploadedWorkbook(
  tournamentId: string,
  fileBytes: Uint8Array,
  database: DatabaseClient = prisma,
  dependencies: PairingImportDependencies = getDefaultDependencies(),
): Promise<UploadedWorkbook> {
  const tournament = await database.tournament.findUnique({ where: { id: tournamentId }, include: { columnMapping: true } });
  if (!tournament) throw new ApiError(404, "TOURNAMENT_NOT_FOUND", vi.tournaments.tournamentNotFound);
  if (fileBytes.byteLength > MAXIMUM_IMPORT_FILE_BYTES) throw new ApiError(413, "IMPORT_FILE_TOO_LARGE", vi.importExport.fileTooLarge);
  if (!ZIP_SIGNATURE.every((signatureByte, byteIndex) => fileBytes[byteIndex] === signatureByte)) {
    throw new ApiError(400, "IMPORT_NOT_XLSX", vi.importExport.notXlsx);
  }
  const outline = await dependencies.pairingImporter.readWorkbookOutline(fileBytes);
  const uploadId = createHash("sha256").update(fileBytes).digest("hex");
  await dependencies.fileStorage.saveFile(buildUploadStorageKey(tournamentId, uploadId), fileBytes);
  return { uploadId, outline, savedMapping: tournament.columnMapping ? (tournament.columnMapping.mapping as unknown as SavedImportMapping) : null };
}

/**
 * Step 4: builds the preview without writing anything.
 *
 * @param tournamentId - Tournament ID.
 * @param importSelection - Upload, round, sheet, header row, mapping, exclusions and player choices.
 * @param database - Client (reads only); a transaction client when called from confirm.
 * @param dependencies - Importer and storage.
 * @returns The preview.
 * @throws ApiError 404 for an unknown round or upload; 400 for an invalid mapping or unreadable file.
 */
export async function buildImportPreview(
  tournamentId: string,
  importSelection: ImportSelection,
  database: DatabaseClient = prisma,
  dependencies: PairingImportDependencies = getDefaultDependencies(),
): Promise<ImportPreview> {
  assertValidColumnMapping(importSelection.columnMapping);
  const round = await database.round.findUnique({ where: { tournamentId_roundNumber: { tournamentId, roundNumber: importSelection.roundNumber } } });
  if (!round) throw new ApiError(404, "ROUND_NOT_FOUND", vi.tournaments.roundNotFound);
  const fileBytes = await loadUploadedFile(tournamentId, importSelection.uploadId, dependencies.fileStorage);
  const sheetData = await dependencies.pairingImporter.readMappedRows(fileBytes, importSelection);

  const excludedRowNumbers = new Set(importSelection.excludedRowNumbers);
  const parsed = parseImportedRows(sheetData.dataRows);
  const includedRows = parsed.rows.filter((row) => !excludedRowNumbers.has(row.rowNumber));
  const knownPlayers = await database.player.findMany({
    where: { tournamentId },
    select: { id: true, swissManagerPlayerId: true, fullName: true, clubOrFederation: true },
  });
  const resolution = resolveImportedPlayers(includedRows, knownPlayers, importSelection.playerChoices);
  const allIssues = [...parsed.issues, ...resolution.issues].filter((issue) => !excludedRowNumbers.has(issue.rowNumber));
  const issues = allIssues
    .map((issue) => toPreviewIssue(issue, sheetData.sheetName, importSelection.columnMapping))
    .sort((first, second) => first.rowNumber - second.rowNumber);

  const existingGames = await database.game.findMany({
    where: { roundId: round.id },
    select: {
      boardNumber: true,
      whitePlayerId: true,
      blackPlayerId: true,
      whitePointsBefore: true,
      blackPointsBefore: true,
      result: { select: { status: true, _count: { select: { events: true } } } },
    },
  });
  const incomingBoards = buildIncomingBoards(includedRows, resolution.targetsByChoiceKey);
  const diff = computeRoundDiff(
    incomingBoards,
    existingGames.map((game) => ({
      boardNumber: game.boardNumber,
      whitePlayerId: game.whitePlayerId,
      blackPlayerId: game.blackPlayerId,
      whitePointsBefore: game.whitePointsBefore?.toNumber() ?? null,
      blackPointsBefore: game.blackPointsBefore?.toNumber() ?? null,
      hasResult: (game.result?.status ?? "NONE") !== "NONE",
      hasResultHistory: (game.result?._count.events ?? 0) > 0,
    })),
  );

  const blockingReasons: string[] = [];
  if (issues.some((issue) => issue.severity === "ERROR")) blockingReasons.push(vi.importExport.unresolvedErrors);
  for (const blockedEntry of diff.entries.filter((entry) => entry.isBlocked)) blockingReasons.push(vi.importExport.blockedRemoval(blockedEntry.boardNumber));

  return {
    sheetName: sheetData.sheetName,
    roundNumber: importSelection.roundNumber,
    rows: parsed.rows.map((row) => ({ ...row, isExcluded: excludedRowNumbers.has(row.rowNumber) })),
    issues,
    skippedRowNumbers: sheetData.skippedRowNumbers,
    diffEntries: diff.entries,
    requiresResultReplacementConfirmation: diff.requiresResultReplacementConfirmation,
    blockingReasons,
    targetsByChoiceKey: resolution.targetsByChoiceKey,
  };
}

/**
 * Removes internal fields so the preview can be sent to the browser.
 *
 * @param importPreview - Full preview.
 * @returns The preview without the resolved-target map.
 */
export function toPublicImportPreview(importPreview: ImportPreview): Omit<ImportPreview, "targetsByChoiceKey"> {
  const publicPreview: Omit<ImportPreview, "targetsByChoiceKey"> & { targetsByChoiceKey?: unknown } = { ...importPreview };
  delete publicPreview.targetsByChoiceKey;
  return publicPreview;
}

/** Inputs of step 5. */
export interface ImportConfirmation extends ImportSelection {
  originalFilename: string;
  isResultReplacementConfirmed: boolean;
}

/**
 * Step 5: applies the import in the caller's transaction.
 *
 * @param tournamentId - Tournament ID.
 * @param importConfirmation - Selection plus file name and the replacement confirmation.
 * @param actor - The TD confirming (logged as uploader; used for result cancellations).
 * @param database - Transaction client; everything is written or nothing is (SRS-IMP-10).
 * @param dependencies - Importer and storage.
 * @returns Number of boards in the round after the import.
 * @throws ApiError 409 IMPORT_NOT_READY (errors or blocked removals), 409 IMPORT_REPLACEMENT_NOT_CONFIRMED.
 */
export async function confirmImport(
  tournamentId: string,
  importConfirmation: ImportConfirmation,
  actor: SignedInUser,
  database: DatabaseClient,
  dependencies: PairingImportDependencies = getDefaultDependencies(),
): Promise<{ roundNumber: number; gameCount: number; pairingImportId: string }> {
  const preview = await buildImportPreview(tournamentId, importConfirmation, database, dependencies);
  if (preview.blockingReasons.length > 0) {
    throw new ApiError(409, "IMPORT_NOT_READY", preview.blockingReasons.join(" "), { blockingReasons: preview.blockingReasons });
  }
  if (preview.requiresResultReplacementConfirmation && !importConfirmation.isResultReplacementConfirmed) {
    throw new ApiError(409, "IMPORT_REPLACEMENT_NOT_CONFIRMED", vi.importExport.replaceConfirmationRequired);
  }
  const round = await database.round.findUniqueOrThrow({ where: { tournamentId_roundNumber: { tournamentId, roundNumber: importConfirmation.roundNumber } } });
  const includedRows = preview.rows.filter((row) => !row.isExcluded);
  const playerIdByTargetKey = await createNewPlayers(tournamentId, includedRows, preview.targetsByChoiceKey, database);
  const incomingByBoard = new Map(buildIncomingBoards(includedRows, preview.targetsByChoiceKey).map((board) => [board.boardNumber, board]));
  const resolvePlayerId = (targetKey: string): string => playerIdByTargetKey.get(targetKey) ?? targetKey.replace(/^existing:/, "");

  for (const diffEntry of preview.diffEntries) {
    const incomingBoard = incomingByBoard.get(diffEntry.boardNumber);
    await applyDiffEntry(round.id, diffEntry, incomingBoard ?? null, resolvePlayerId, { actor, originalFilename: importConfirmation.originalFilename }, database);
  }

  const pairingImport = await database.pairingImport.create({
    data: {
      tournamentId,
      roundId: round.id,
      originalFilename: importConfirmation.originalFilename.slice(0, 255),
      fileSha256: importConfirmation.uploadId,
      storageKey: buildUploadStorageKey(tournamentId, importConfirmation.uploadId),
      uploadedByUserId: actor.id,
      rowCount: includedRows.length,
      excludedRows: importConfirmation.excludedRowNumbers,
      rowErrors: preview.issues.map((issue) => ({ rowNumber: issue.rowNumber, column: issue.columnLetter, code: issue.code, severity: issue.severity, message: issue.messageVi })),
    },
  });
  const savedMapping: SavedImportMapping = {
    sheetName: importConfirmation.sheetName,
    headerRowNumber: importConfirmation.headerRowNumber,
    columnMapping: importConfirmation.columnMapping,
  };
  await database.columnMapping.upsert({
    where: { tournamentId },
    update: { mapping: savedMapping as unknown as Prisma.InputJsonObject },
    create: { tournamentId, mapping: savedMapping as unknown as Prisma.InputJsonObject },
  });
  await database.round.update({ where: { id: round.id }, data: { status: "PUBLISHED" } });
  await notifyTournamentChanged({ tournamentId, roundNumber: importConfirmation.roundNumber }, database);
  return { roundNumber: importConfirmation.roundNumber, gameCount: await database.game.count({ where: { roundId: round.id } }), pairingImportId: pairingImport.id };
}

/**
 * Applies one diff entry.
 *
 * @param roundId - Round ID.
 * @param diffEntry - What changes on this board.
 * @param incomingBoard - The board from the file (null for REMOVED).
 * @param resolvePlayerId - Maps a target key to a player ID.
 * @param context - Acting TD and file name (for the cancellation reason).
 * @param database - Transaction client.
 */
async function applyDiffEntry(
  roundId: string,
  diffEntry: RoundDiffEntry,
  incomingBoard: IncomingBoard | null,
  resolvePlayerId: (targetKey: string) => string,
  context: { actor: SignedInUser; originalFilename: string },
  database: DatabaseClient,
): Promise<void> {
  const existingGame = await database.game.findUnique({
    where: { roundId_boardNumber: { roundId, boardNumber: diffEntry.boardNumber } },
    include: { result: { select: { status: true, version: true } } },
  });
  if (diffEntry.kind === "REMOVED") {
    // Only boards without result history get here (others block the import), so the delete cannot hit the audit log.
    if (existingGame) await database.game.delete({ where: { id: existingGame.id } });
    return;
  }
  if (!incomingBoard || diffEntry.kind === "UNCHANGED") return;
  const gameData = {
    whitePlayerId: resolvePlayerId(incomingBoard.whiteTargetKey),
    blackPlayerId: incomingBoard.blackTargetKey ? resolvePlayerId(incomingBoard.blackTargetKey) : null,
    whitePointsBefore: incomingBoard.whitePointsBefore === null ? null : new Prisma.Decimal(incomingBoard.whitePointsBefore),
    blackPointsBefore: incomingBoard.blackPointsBefore === null ? null : new Prisma.Decimal(incomingBoard.blackPointsBefore),
  };
  if (diffEntry.kind === "ADDED" || !existingGame) {
    await database.game.create({ data: { ...gameData, roundId, boardNumber: diffEntry.boardNumber, result: { create: { status: "NONE" } } } });
    return;
  }
  if (diffEntry.kind === "PLAYERS_CHANGED" && existingGame.result && existingGame.result.status !== "NONE") {
    // CLAUDE.md §2: the result is cleared only through the state machine, with an audit event and reason.
    await applyResultTransition(
      {
        gameId: existingGame.id,
        expectedVersion: existingGame.result.version,
        actionRequest: { type: "CANCEL", reason: vi.importExport.cancelReasonForReimport(context.originalFilename) },
        actor: context.actor,
      },
      database,
    );
  }
  await database.game.update({ where: { id: existingGame.id }, data: gameData });
}

/**
 * Creates the players that the import needs and are not yet in the tournament.
 *
 * @param tournamentId - Tournament ID.
 * @param includedRows - Rows being imported.
 * @param targetsByChoiceKey - Resolved targets.
 * @param database - Transaction client.
 * @returns New-player key → created player ID.
 */
async function createNewPlayers(
  tournamentId: string,
  includedRows: readonly PreviewRow[],
  targetsByChoiceKey: Map<string, ImportPlayerTarget>,
  database: DatabaseClient,
): Promise<Map<string, string>> {
  const playerIdByTargetKey = new Map<string, string>();
  for (const row of includedRows) {
    for (const side of ["WHITE", "BLACK"] as const) {
      const importedSide = side === "WHITE" ? row.white : row.black;
      const target = targetsByChoiceKey.get(buildPlayerChoiceKey(row.rowNumber, side));
      if (!importedSide || target?.kind !== "CREATE" || playerIdByTargetKey.has(target.newPlayerKey)) continue;
      const createdPlayer = await database.player.create({
        data: {
          tournamentId,
          swissManagerPlayerId: importedSide.swissManagerPlayerId,
          fullName: importedSide.fullName,
          clubOrFederation: importedSide.clubOrFederation,
        },
      });
      playerIdByTargetKey.set(target.newPlayerKey, createdPlayer.id);
    }
  }
  return playerIdByTargetKey;
}

/**
 * Turns rows with resolved players into incoming boards; rows with unresolved sides are left out (they carry errors).
 *
 * @param rows - Included rows.
 * @param targetsByChoiceKey - Resolved targets.
 * @returns Boards keyed by player target keys.
 */
function buildIncomingBoards(rows: readonly ImportedRow[], targetsByChoiceKey: Map<string, ImportPlayerTarget>): IncomingBoard[] {
  const toTargetKey = (target: ImportPlayerTarget | undefined) =>
    target === undefined ? undefined : target.kind === "EXISTING" ? `existing:${target.playerId}` : target.newPlayerKey;
  return rows.flatMap((row) => {
    const whiteTargetKey = toTargetKey(targetsByChoiceKey.get(buildPlayerChoiceKey(row.rowNumber, "WHITE")));
    const blackTargetKey = row.black ? toTargetKey(targetsByChoiceKey.get(buildPlayerChoiceKey(row.rowNumber, "BLACK"))) : null;
    if (row.boardNumber === null || whiteTargetKey === undefined || blackTargetKey === undefined) return [];
    return [{ boardNumber: row.boardNumber, whiteTargetKey, blackTargetKey, whitePointsBefore: row.white.pointsBefore, blackPointsBefore: row.black?.pointsBefore ?? null }];
  });
}

/**
 * Checks that required fields are mapped and no column is used twice.
 *
 * @param columnMapping - Field → column letter.
 * @throws ApiError 400 IMPORT_MAPPING_INVALID.
 */
function assertValidColumnMapping(columnMapping: PairingColumnMapping): void {
  for (const requiredField of REQUIRED_MAPPED_FIELDS) {
    if (!columnMapping[requiredField]) {
      throw new ApiError(400, "IMPORT_MAPPING_INVALID", vi.importExport.requiredFieldMissing(vi.importExport.fieldLabels[requiredField] ?? requiredField));
    }
  }
  const seenColumnLetters = new Set<string>();
  for (const columnLetter of Object.values(columnMapping)) {
    if (!columnLetter) continue;
    const upperLetter = columnLetter.toUpperCase();
    if (convertColumnLetterToNumber(upperLetter) === null || seenColumnLetters.has(upperLetter)) {
      throw new ApiError(400, "IMPORT_MAPPING_INVALID", vi.importExport.duplicateColumnMapping(upperLetter));
    }
    seenColumnLetters.add(upperLetter);
  }
}

/**
 * Adds the column letter and the SRS-IMP-05 message to an issue.
 *
 * @param issue - Domain issue.
 * @param sheetName - Sheet name.
 * @param columnMapping - Mapping, to find the issue's column.
 * @returns Display issue.
 */
function toPreviewIssue(issue: ImportCellIssue, sheetName: string, columnMapping: PairingColumnMapping): PreviewIssue {
  const columnLetter = (columnMapping[issue.field] ?? "?").toUpperCase();
  const issueMessages = vi.importExport.issueMessages;
  const issueText = {
    MISSING_REQUIRED_VALUE: issueMessages.missingRequiredValue,
    BOARD_NOT_POSITIVE_INTEGER: issueMessages.boardNotPositiveInteger,
    DUPLICATE_BOARD: issueMessages.duplicateBoard(issue.details?.otherRowNumber ?? 0),
    POINTS_INVALID: issueMessages.pointsInvalid,
    PLAYER_ON_TWO_BOARDS: issueMessages.playerOnTwoBoards(issue.details?.otherRowNumber ?? 0),
    PLAYER_ID_NAME_MISMATCH: issueMessages.playerIdNameMismatch(issue.details?.existingName ?? ""),
    AMBIGUOUS_PLAYER_NAME: issueMessages.ambiguousPlayerName,
    NEW_PLAYER: issueMessages.newPlayer,
  }[issue.code];
  return { ...issue, columnLetter, messageVi: vi.importExport.rowError(sheetName, issue.rowNumber, columnLetter, issueText) };
}

/**
 * Storage key of an uploaded workbook.
 *
 * @param tournamentId - Tournament ID.
 * @param uploadId - SHA-256 of the file.
 * @returns Relative storage key.
 */
function buildUploadStorageKey(tournamentId: string, uploadId: string): string {
  return `imports/${tournamentId}/${uploadId}.xlsx`;
}

/**
 * Loads an uploaded file.
 *
 * @param tournamentId - Tournament ID.
 * @param uploadId - Upload ID from step 1.
 * @param fileStorage - Storage.
 * @returns File bytes.
 * @throws ApiError 404 IMPORT_UPLOAD_NOT_FOUND.
 */
async function loadUploadedFile(tournamentId: string, uploadId: string, fileStorage: FileStorage): Promise<Uint8Array> {
  const fileBytes = UPLOAD_ID_PATTERN.test(uploadId) ? await fileStorage.readFile(buildUploadStorageKey(tournamentId, uploadId)) : null;
  if (!fileBytes) throw new ApiError(404, "IMPORT_UPLOAD_NOT_FOUND", vi.importExport.uploadNotFound);
  return fileBytes;
}
