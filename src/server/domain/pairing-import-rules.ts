// src/server/domain/pairing-import-rules.ts
// Pure rules for importing pairings from a mapped spreadsheet (SRS-IMP-02..09, BR-02):
//   - the mappable fields and column-letter helpers (the TD maps columns; no layout is assumed, SRS-IMP-12);
//   - parsing of board numbers and points (0.5 steps, "½", "1½", "1,5");
//   - header-row auto-detection (first row with ≥ 4 non-empty text cells, SRS-IMP-02);
//   - row validation and player resolution: ID first, exact normalized name second, never auto-merged (SRS-IMP-06, 08);
//   - the diff against the round's existing games (SRS-IMP-09).
// No ExcelJS, database or HTTP here; the importer and service feed plain values in.

import { normalizePlayerNameForMatching } from "@/server/domain/search-text-normalizer";

/** Fields the TD can map to a column (SRS-IMP-03). "result" is shown in the preview but never imported. */
export const PAIRING_IMPORT_FIELDS = [
  "boardNumber",
  "whiteName",
  "whitePlayerId",
  "whiteClub",
  "whitePoints",
  "blackName",
  "blackPlayerId",
  "blackClub",
  "blackPoints",
  "result",
] as const;

/** One mappable field. */
export type PairingImportField = (typeof PAIRING_IMPORT_FIELDS)[number];

/** Field → column letter ("A", "B", … "AA"). Unmapped optional fields are absent. */
export type PairingColumnMapping = Partial<Record<PairingImportField, string>>;

/** Fields that must be mapped before a preview (SRS-IMP-03). Black name is required unless the round has byes only. */
export const REQUIRED_MAPPED_FIELDS: readonly PairingImportField[] = ["boardNumber", "whiteName", "blackName"];

/** Fields that identify a player; a row with all of them empty is not a pairing row (e.g. a footer line). */
const PLAYER_IDENTIFYING_FIELDS: readonly PairingImportField[] = ["whiteName", "whitePlayerId", "blackName", "blackPlayerId"];

/** Black-name values that mean "no opponent" in common exports (compared after normalization). */
const BYE_MARKERS = new Set(["bye", "spielfrei", "mien dau", "miễn đấu", "khong co doi thu", "không có đối thủ", "-"]);

/**
 * Converts a 1-based column number to its letter ("A", …, "Z", "AA").
 *
 * @param columnNumber - 1-based column number.
 * @returns Column letters.
 */
export function convertColumnNumberToLetter(columnNumber: number): string {
  let remaining = columnNumber;
  let columnLetter = "";
  while (remaining > 0) {
    const letterIndex = (remaining - 1) % 26;
    columnLetter = String.fromCharCode(65 + letterIndex) + columnLetter;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return columnLetter;
}

/**
 * Converts column letters to a 1-based number.
 *
 * @param columnLetter - "A", "B", … "AA" (case-insensitive).
 * @returns Column number, or null for anything that is not letters.
 */
export function convertColumnLetterToNumber(columnLetter: string): number | null {
  if (!/^[A-Za-z]{1,3}$/.test(columnLetter)) return null;
  return columnLetter
    .toUpperCase()
    .split("")
    .reduce((columnNumber, letter) => columnNumber * 26 + (letter.charCodeAt(0) - 64), 0);
}

/**
 * Parses a board number cell.
 *
 * @param cellText - Text of the cell.
 * @returns A positive integer, or null when the text is not one.
 */
export function parseBoardNumber(cellText: string): number | null {
  const trimmedText = cellText.trim();
  if (!/^\d+(\.0+)?$/.test(trimmedText)) return null;
  const boardNumber = Number(trimmedText);
  return Number.isInteger(boardNumber) && boardNumber >= 1 ? boardNumber : null;
}

/** Result of parsing a points cell. */
export type ParsedPoints = { kind: "EMPTY" } | { kind: "VALID"; points: number } | { kind: "INVALID" };

/**
 * Parses points before the round. Accepts "0", "1.5", "1,5", "½", "1½"; scores are multiples of 0.5 (SRS-IMP-06).
 *
 * @param cellText - Text of the cell.
 * @returns EMPTY, VALID with the number, or INVALID.
 */
export function parsePointsBefore(cellText: string): ParsedPoints {
  const trimmedText = cellText.trim();
  if (trimmedText === "") return { kind: "EMPTY" };
  const halfGlyphMatch = /^(\d*)\s*½$/.exec(trimmedText);
  const numericValue = halfGlyphMatch ? Number(halfGlyphMatch[1] || "0") + 0.5 : Number(trimmedText.replace(",", "."));
  if (!Number.isFinite(numericValue) || numericValue < 0 || !Number.isInteger(numericValue * 2)) {
    return { kind: "INVALID" };
  }
  return { kind: "VALID", points: numericValue };
}

/**
 * Finds the header row: the first row with at least 4 non-empty text (non-numeric) cells (SRS-IMP-02).
 *
 * @param rows - Leading rows as arrays of cell texts, with their 1-based row numbers.
 * @returns The header row number, or null when none qualifies.
 */
export function detectHeaderRowNumber(rows: readonly { rowNumber: number; cellTexts: readonly string[] }[]): number | null {
  const headerRow = rows.find(
    (row) => row.cellTexts.filter((cellText) => cellText.trim() !== "" && Number.isNaN(Number(cellText.trim()))).length >= 4,
  );
  return headerRow?.rowNumber ?? null;
}

/**
 * Whether a Black-name value means the White player has a bye.
 *
 * @param blackNameText - Text in the Black-name column.
 * @returns true for an empty cell or a known bye marker.
 */
export function isByeMarker(blackNameText: string): boolean {
  const normalizedText = blackNameText.trim().toLowerCase();
  return normalizedText === "" || BYE_MARKERS.has(normalizedText) || BYE_MARKERS.has(normalizedText.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d"));
}

/** A spreadsheet row reduced to the texts of the mapped fields. */
export interface MappedSheetRow {
  rowNumber: number;
  cellTextByField: Partial<Record<PairingImportField, string>>;
}

/**
 * Whether a row carries pairing data. Rows with every player-identifying cell empty (blank lines, source footers)
 * are skipped and listed rather than reported as errors.
 *
 * @param mappedRow - The row.
 * @returns true when at least one player name or ID cell is non-empty.
 */
export function isPairingDataRow(mappedRow: MappedSheetRow): boolean {
  return PLAYER_IDENTIFYING_FIELDS.some((fieldName) => (mappedRow.cellTextByField[fieldName] ?? "").trim() !== "");
}

/** One side of an imported board after parsing. */
export interface ImportedSide {
  swissManagerPlayerId: string | null;
  fullName: string;
  clubOrFederation: string | null;
  pointsBefore: number | null;
}

/** A parsed row (values may be missing; issues say why). */
export interface ImportedRow {
  rowNumber: number;
  boardNumber: number | null;
  white: ImportedSide;
  /** null for a bye. */
  black: ImportedSide | null;
  resultText: string | null;
}

/** A problem tied to one cell, so the message can name sheet, row and column (SRS-IMP-05). */
export interface ImportCellIssue {
  rowNumber: number;
  field: PairingImportField;
  code:
    | "MISSING_REQUIRED_VALUE"
    | "BOARD_NOT_POSITIVE_INTEGER"
    | "DUPLICATE_BOARD"
    | "POINTS_INVALID"
    | "PLAYER_ON_TWO_BOARDS"
    | "PLAYER_ID_NAME_MISMATCH"
    | "AMBIGUOUS_PLAYER_NAME"
    | "NEW_PLAYER";
  /** ERROR blocks the import until fixed or the row is excluded; NOTICE is informational. */
  severity: "ERROR" | "NOTICE";
  /** Extra data for the message: other board/row, existing name, candidate players. */
  details?: { otherRowNumber?: number; existingName?: string; candidates?: { playerId: string; fullName: string; clubOrFederation: string | null }[] };
}

/** An existing player of the tournament. */
export interface KnownImportPlayer {
  id: string;
  swissManagerPlayerId: string | null;
  fullName: string;
  clubOrFederation: string | null;
}

/** How a side resolves: an existing player, or a new player identified by a key shared across rows of the file. */
export type ImportPlayerTarget = { kind: "EXISTING"; playerId: string } | { kind: "CREATE"; newPlayerKey: string };

/** TD choice for an ambiguous name, keyed by "rowNumber:WHITE|BLACK": an existing player ID or "CREATE". */
export type PlayerChoices = Record<string, string>;

/**
 * Builds the key for a TD player choice.
 *
 * @param rowNumber - Excel row number.
 * @param side - WHITE or BLACK.
 * @returns "rowNumber:side".
 */
export function buildPlayerChoiceKey(rowNumber: number, side: "WHITE" | "BLACK"): string {
  return `${rowNumber}:${side}`;
}

/**
 * Parses mapped rows into typed values, collecting cell-level parse issues.
 *
 * @param mappedRows - Pairing data rows (non-data rows already removed).
 * @returns Parsed rows and their issues.
 */
export function parseImportedRows(mappedRows: readonly MappedSheetRow[]): { rows: ImportedRow[]; issues: ImportCellIssue[] } {
  const issues: ImportCellIssue[] = [];
  const rows = mappedRows.map((mappedRow): ImportedRow => {
    const text = (fieldName: PairingImportField) => (mappedRow.cellTextByField[fieldName] ?? "").trim();
    const addIssue = (field: PairingImportField, code: ImportCellIssue["code"]) => issues.push({ rowNumber: mappedRow.rowNumber, field, code, severity: "ERROR" });

    const boardText = text("boardNumber");
    const boardNumber = parseBoardNumber(boardText);
    if (boardText === "") addIssue("boardNumber", "MISSING_REQUIRED_VALUE");
    else if (boardNumber === null) addIssue("boardNumber", "BOARD_NOT_POSITIVE_INTEGER");

    const parseSide = (sideName: "white" | "black"): ImportedSide => {
      const pointsField = `${sideName}Points` as const;
      const parsedPoints = parsePointsBefore(text(pointsField));
      if (parsedPoints.kind === "INVALID") addIssue(pointsField, "POINTS_INVALID");
      return {
        swissManagerPlayerId: text(`${sideName}PlayerId`) || null,
        fullName: text(`${sideName}Name`),
        clubOrFederation: text(`${sideName}Club`) || null,
        pointsBefore: parsedPoints.kind === "VALID" ? parsedPoints.points : null,
      };
    };
    const white = parseSide("white");
    if (white.fullName === "") addIssue("whiteName", "MISSING_REQUIRED_VALUE");
    const blackSide = parseSide("black");
    const isBye = isByeMarker(blackSide.fullName) && blackSide.swissManagerPlayerId === null;
    return { rowNumber: mappedRow.rowNumber, boardNumber, white, black: isBye ? null : blackSide, resultText: text("result") || null };
  });
  return { rows, issues };
}

/**
 * Resolves every side of the rows to existing or new players and finds identity problems (SRS-IMP-06, 08):
 * ID matching a different name, a name without ID matching several players (needs a TD choice), the same
 * player on two boards, duplicate board numbers. Never merges players automatically.
 *
 * @param rows - Parsed, non-excluded rows.
 * @param knownPlayers - Players already in the tournament.
 * @param playerChoices - TD choices for ambiguous names.
 * @returns Targets per row side and the issues found.
 */
export function resolveImportedPlayers(
  rows: readonly ImportedRow[],
  knownPlayers: readonly KnownImportPlayer[],
  playerChoices: PlayerChoices,
): { targetsByChoiceKey: Map<string, ImportPlayerTarget>; issues: ImportCellIssue[] } {
  const issues: ImportCellIssue[] = [];
  const targetsByChoiceKey = new Map<string, ImportPlayerTarget>();
  const firstRowByBoard = new Map<number, number>();
  const firstRowByTargetKey = new Map<string, number>();
  const nameByImportedId = new Map<string, { fullName: string; rowNumber: number }>();

  for (const row of rows) {
    if (row.boardNumber !== null) {
      const firstRowNumber = firstRowByBoard.get(row.boardNumber);
      if (firstRowNumber !== undefined) {
        issues.push({ rowNumber: row.rowNumber, field: "boardNumber", code: "DUPLICATE_BOARD", severity: "ERROR", details: { otherRowNumber: firstRowNumber } });
      } else {
        firstRowByBoard.set(row.boardNumber, row.rowNumber);
      }
    }
    for (const side of ["WHITE", "BLACK"] as const) {
      const importedSide = side === "WHITE" ? row.white : row.black;
      if (!importedSide || importedSide.fullName === "") continue;
      const nameField: PairingImportField = side === "WHITE" ? "whiteName" : "blackName";
      const idField: PairingImportField = side === "WHITE" ? "whitePlayerId" : "blackPlayerId";

      // The same ID used with two different names inside the file is a data error, not two players.
      if (importedSide.swissManagerPlayerId) {
        const earlierUse = nameByImportedId.get(importedSide.swissManagerPlayerId);
        if (earlierUse && normalizePlayerNameForMatching(earlierUse.fullName) !== normalizePlayerNameForMatching(importedSide.fullName)) {
          issues.push({ rowNumber: row.rowNumber, field: idField, code: "PLAYER_ID_NAME_MISMATCH", severity: "ERROR", details: { existingName: earlierUse.fullName, otherRowNumber: earlierUse.rowNumber } });
          continue;
        }
        nameByImportedId.set(importedSide.swissManagerPlayerId, { fullName: importedSide.fullName, rowNumber: row.rowNumber });
      }

      const choiceKey = buildPlayerChoiceKey(row.rowNumber, side);
      const target = resolveOneSide(importedSide, knownPlayers, choiceKey, playerChoices[choiceKey]);
      if (target.kind === "ISSUE") {
        issues.push({ rowNumber: row.rowNumber, field: target.code === "PLAYER_ID_NAME_MISMATCH" ? idField : nameField, code: target.code, severity: "ERROR", details: target.details });
        continue;
      }
      if (target.kind === "CREATE" && !importedSide.swissManagerPlayerId && knownPlayers.length > 0) {
        issues.push({ rowNumber: row.rowNumber, field: nameField, code: "NEW_PLAYER", severity: "NOTICE" });
      }
      const targetKey = target.kind === "EXISTING" ? `existing:${target.playerId}` : target.newPlayerKey;
      const firstRowNumber = firstRowByTargetKey.get(targetKey);
      if (firstRowNumber !== undefined) {
        issues.push({ rowNumber: row.rowNumber, field: nameField, code: "PLAYER_ON_TWO_BOARDS", severity: "ERROR", details: { otherRowNumber: firstRowNumber } });
        continue;
      }
      firstRowByTargetKey.set(targetKey, row.rowNumber);
      targetsByChoiceKey.set(choiceKey, target);
    }
  }
  return { targetsByChoiceKey, issues };
}

/**
 * Resolves one side.
 *
 * @param importedSide - Side from the file.
 * @param knownPlayers - Existing players.
 * @param choiceKey - "rowNumber:side", used to key a TD-requested new player.
 * @param playerChoice - TD choice for this side, if any.
 * @returns A target or the identity issue.
 */
function resolveOneSide(
  importedSide: ImportedSide,
  knownPlayers: readonly KnownImportPlayer[],
  choiceKey: string,
  playerChoice: string | undefined,
): ImportPlayerTarget | { kind: "ISSUE"; code: "PLAYER_ID_NAME_MISMATCH" | "AMBIGUOUS_PLAYER_NAME"; details: NonNullable<ImportCellIssue["details"]> } {
  const normalizedName = normalizePlayerNameForMatching(importedSide.fullName);
  if (importedSide.swissManagerPlayerId) {
    const playerWithId = knownPlayers.find((player) => player.swissManagerPlayerId === importedSide.swissManagerPlayerId);
    if (!playerWithId) return { kind: "CREATE", newPlayerKey: `id:${importedSide.swissManagerPlayerId}` };
    return normalizePlayerNameForMatching(playerWithId.fullName) === normalizedName
      ? { kind: "EXISTING", playerId: playerWithId.id }
      : { kind: "ISSUE", code: "PLAYER_ID_NAME_MISMATCH", details: { existingName: playerWithId.fullName } };
  }
  const nameMatches = knownPlayers.filter((player) => normalizePlayerNameForMatching(player.fullName) === normalizedName);
  if (nameMatches.length === 1 && nameMatches[0]) return { kind: "EXISTING", playerId: nameMatches[0].id };
  if (nameMatches.length === 0) return { kind: "CREATE", newPlayerKey: `name:${normalizedName}` };
  // SRS-IMP-08: several players share the name; the TD must choose one or create a new player.
  // The TD said this is a different person with the same name: a new player unique to this row and side.
  if (playerChoice === "CREATE") return { kind: "CREATE", newPlayerKey: `chosen-new:${choiceKey}` };
  if (playerChoice && nameMatches.some((player) => player.id === playerChoice)) return { kind: "EXISTING", playerId: playerChoice };
  return {
    kind: "ISSUE",
    code: "AMBIGUOUS_PLAYER_NAME",
    details: { candidates: nameMatches.map((player) => ({ playerId: player.id, fullName: player.fullName, clubOrFederation: player.clubOrFederation })) },
  };
}

/** A board as it would be after the import. */
export interface IncomingBoard {
  boardNumber: number;
  whiteTargetKey: string;
  blackTargetKey: string | null;
  whitePointsBefore: number | null;
  blackPointsBefore: number | null;
}

/** A board currently in the round. */
export interface ExistingBoard {
  boardNumber: number;
  whitePlayerId: string;
  blackPlayerId: string | null;
  whitePointsBefore: number | null;
  blackPointsBefore: number | null;
  /** Result status other than NONE. */
  hasResult: boolean;
  /** Any result_events exist (the game can then never be deleted, SRS-AUD-02). */
  hasResultHistory: boolean;
}

/** One line of the diff (SRS-IMP-09). */
export interface RoundDiffEntry {
  boardNumber: number;
  kind: "ADDED" | "REMOVED" | "PLAYERS_CHANGED" | "POINTS_CHANGED" | "UNCHANGED";
  hasResult: boolean;
  /** REMOVED with history: cannot be applied at all. */
  isBlocked: boolean;
}

/**
 * Compares the incoming boards with the round's existing games by board number.
 *
 * @param incomingBoards - Boards from the file, with resolved player keys ("existing:<id>" or a new-player key).
 * @param existingBoards - Current games of the round.
 * @returns Diff entries sorted by board, plus whether a second confirmation is required.
 */
export function computeRoundDiff(
  incomingBoards: readonly IncomingBoard[],
  existingBoards: readonly ExistingBoard[],
): { entries: RoundDiffEntry[]; requiresResultReplacementConfirmation: boolean; hasBlockedEntries: boolean } {
  const existingByBoard = new Map(existingBoards.map((existingBoard) => [existingBoard.boardNumber, existingBoard]));
  const incomingBoardNumbers = new Set(incomingBoards.map((incomingBoard) => incomingBoard.boardNumber));
  const entries: RoundDiffEntry[] = incomingBoards.map((incomingBoard) => {
    const existingBoard = existingByBoard.get(incomingBoard.boardNumber);
    if (!existingBoard) return { boardNumber: incomingBoard.boardNumber, kind: "ADDED", hasResult: false, isBlocked: false };
    const arePlayersSame =
      incomingBoard.whiteTargetKey === `existing:${existingBoard.whitePlayerId}` &&
      incomingBoard.blackTargetKey === (existingBoard.blackPlayerId ? `existing:${existingBoard.blackPlayerId}` : null);
    const arePointsSame =
      incomingBoard.whitePointsBefore === existingBoard.whitePointsBefore && incomingBoard.blackPointsBefore === existingBoard.blackPointsBefore;
    const kind = !arePlayersSame ? "PLAYERS_CHANGED" : !arePointsSame ? "POINTS_CHANGED" : "UNCHANGED";
    return { boardNumber: incomingBoard.boardNumber, kind, hasResult: existingBoard.hasResult, isBlocked: false };
  });
  for (const existingBoard of existingBoards) {
    if (!incomingBoardNumbers.has(existingBoard.boardNumber)) {
      entries.push({ boardNumber: existingBoard.boardNumber, kind: "REMOVED", hasResult: existingBoard.hasResult, isBlocked: existingBoard.hasResultHistory });
    }
  }
  entries.sort((first, second) => first.boardNumber - second.boardNumber);
  return {
    entries,
    // SRS-IMP-09: replacing games that already have a result needs a second, explicit confirmation.
    requiresResultReplacementConfirmation: entries.some((entry) => entry.hasResult && (entry.kind === "PLAYERS_CHANGED" || entry.kind === "REMOVED")),
    hasBlockedEntries: entries.some((entry) => entry.isBlocked),
  };
}
