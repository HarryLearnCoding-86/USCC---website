// tests/unit/domain/pairing-import-rules.test.ts
// Unit tests for the pure import rules (SRS-IMP-02..09): column letters, board and points parsing, header
// detection, bye markers, row parsing issues, player resolution without auto-merge, and the round diff.

import { describe, expect, it } from "vitest";
import {
  computeRoundDiff,
  convertColumnLetterToNumber,
  convertColumnNumberToLetter,
  detectHeaderRowNumber,
  isByeMarker,
  isPairingDataRow,
  parseBoardNumber,
  parseImportedRows,
  parsePointsBefore,
  resolveImportedPlayers,
  type ImportedRow,
  type KnownImportPlayer,
} from "@/server/domain/pairing-import-rules";

describe("column letters", () => {
  it.each([
    [1, "A"],
    [8, "H"],
    [26, "Z"],
    [27, "AA"],
    [52, "AZ"],
  ])("%i ↔ %s", (columnNumber, columnLetter) => {
    expect(convertColumnNumberToLetter(columnNumber)).toBe(columnLetter);
    expect(convertColumnLetterToNumber(columnLetter)).toBe(columnNumber);
    expect(convertColumnLetterToNumber(columnLetter.toLowerCase())).toBe(columnNumber);
  });

  it("rejects non-letters", () => {
    expect(convertColumnLetterToNumber("A1")).toBeNull();
    expect(convertColumnLetterToNumber("")).toBeNull();
  });
});

describe("cell parsing", () => {
  it("parses board numbers", () => {
    expect(parseBoardNumber("12")).toBe(12);
    expect(parseBoardNumber(" 3 ")).toBe(3);
    expect(parseBoardNumber("4.0")).toBe(4);
    expect(parseBoardNumber("0")).toBeNull();
    expect(parseBoardNumber("1.5")).toBeNull();
    expect(parseBoardNumber("Bàn 1")).toBeNull();
  });

  it.each([
    ["", { kind: "EMPTY" }],
    ["0", { kind: "VALID", points: 0 }],
    ["1.5", { kind: "VALID", points: 1.5 }],
    ["1,5", { kind: "VALID", points: 1.5 }],
    ["½", { kind: "VALID", points: 0.5 }],
    ["2½", { kind: "VALID", points: 2.5 }],
    ["1.25", { kind: "INVALID" }],
    ["-1", { kind: "INVALID" }],
    ["abc", { kind: "INVALID" }],
  ])("points %j", (cellText, expectedPoints) => {
    expect(parsePointsBefore(cellText)).toEqual(expectedPoints);
  });

  it("detects the header row as the first row with ≥ 4 text cells (SRS-IMP-02)", () => {
    const leadingRows = [
      { rowNumber: 1, cellTexts: ["Từ cơ sở dữ liệu giải đấu"] },
      { rowNumber: 5, cellTexts: ["1. Ván"] },
      { rowNumber: 6, cellTexts: ["Bàn", "White", "LĐ", "Điểm", "Kết quả", "Điểm", "Black", "LĐ"] },
      { rowNumber: 7, cellTexts: ["1", "A", "UIT", "0", "½ - ½", "0", "B", "IUC"] },
    ];
    expect(detectHeaderRowNumber(leadingRows)).toBe(6);
    expect(detectHeaderRowNumber([{ rowNumber: 1, cellTexts: ["1", "2", "3", "4"] }])).toBeNull();
  });

  it("recognises byes and non-data rows", () => {
    expect(isByeMarker("")).toBe(true);
    expect(isByeMarker("BYE")).toBe(true);
    expect(isByeMarker("Miễn đấu")).toBe(true);
    expect(isByeMarker("Nguyễn Văn An")).toBe(false);
    expect(isPairingDataRow({ rowNumber: 48, cellTextByField: { boardNumber: "Nguồn: chess-results" } })).toBe(false);
    expect(isPairingDataRow({ rowNumber: 7, cellTextByField: { boardNumber: "1", whiteName: "A" } })).toBe(true);
  });
});

describe("parseImportedRows", () => {
  it("reports missing values, bad boards and bad points per cell", () => {
    const { rows, issues } = parseImportedRows([
      { rowNumber: 7, cellTextByField: { boardNumber: "1", whiteName: "Trắng A", blackName: "Đen B", whitePoints: "1½" } },
      { rowNumber: 8, cellTextByField: { boardNumber: "x", whiteName: "", blackName: "Đen C", blackPoints: "1.3" } },
      { rowNumber: 9, cellTextByField: { boardNumber: "", whiteName: "Trắng D", blackName: "bye" } },
    ]);
    expect(rows[0]).toMatchObject({ boardNumber: 1, white: { fullName: "Trắng A", pointsBefore: 1.5 }, black: { fullName: "Đen B" } });
    expect(rows[2]?.black).toBeNull();
    expect(issues.map((issue) => [issue.rowNumber, issue.field, issue.code])).toEqual([
      [8, "boardNumber", "BOARD_NOT_POSITIVE_INTEGER"],
      [8, "whiteName", "MISSING_REQUIRED_VALUE"],
      [8, "blackPoints", "POINTS_INVALID"],
      [9, "boardNumber", "MISSING_REQUIRED_VALUE"],
    ]);
  });
});

describe("resolveImportedPlayers (SRS-IMP-06, 08)", () => {
  const side = (fullName: string, swissManagerPlayerId: string | null = null) => ({ fullName, swissManagerPlayerId, clubOrFederation: null, pointsBefore: null });
  const row = (rowNumber: number, boardNumber: number, white: ReturnType<typeof side>, black: ReturnType<typeof side> | null): ImportedRow => ({ rowNumber, boardNumber, white, black, resultText: null });
  const knownPlayers: KnownImportPlayer[] = [
    { id: "p1", swissManagerPlayerId: "101", fullName: "Lê Văn An", clubOrFederation: "A" },
    { id: "p2", swissManagerPlayerId: null, fullName: "Trùng Tên", clubOrFederation: "B" },
    { id: "p3", swissManagerPlayerId: null, fullName: "Trùng Tên", clubOrFederation: "C" },
  ];

  it("matches by ID, then unique name, and creates the rest", () => {
    const { targetsByChoiceKey, issues } = resolveImportedPlayers([row(7, 1, side("lê văn an", "101"), side("Người Mới"))], knownPlayers, {});
    expect(targetsByChoiceKey.get("7:WHITE")).toEqual({ kind: "EXISTING", playerId: "p1" });
    expect(targetsByChoiceKey.get("7:BLACK")).toEqual({ kind: "CREATE", newPlayerKey: "name:người mới" });
    expect(issues).toEqual([{ rowNumber: 7, field: "blackName", code: "NEW_PLAYER", severity: "NOTICE" }]);
  });

  it("flags an ID that belongs to another name, and never merges", () => {
    const { issues } = resolveImportedPlayers([row(7, 1, side("Tên Khác", "101"), null)], knownPlayers, {});
    expect(issues).toEqual([expect.objectContaining({ field: "whitePlayerId", code: "PLAYER_ID_NAME_MISMATCH", details: { existingName: "Lê Văn An" } })]);
  });

  it("asks the TD to choose for an ambiguous name, then honours the choice", () => {
    const ambiguous = resolveImportedPlayers([row(7, 1, side("Trùng Tên"), null)], knownPlayers, {});
    expect(ambiguous.issues[0]).toMatchObject({ code: "AMBIGUOUS_PLAYER_NAME", details: { candidates: [{ playerId: "p2" }, { playerId: "p3" }] } });
    expect(resolveImportedPlayers([row(7, 1, side("Trùng Tên"), null)], knownPlayers, { "7:WHITE": "p3" }).targetsByChoiceKey.get("7:WHITE")).toEqual({ kind: "EXISTING", playerId: "p3" });
    expect(resolveImportedPlayers([row(7, 1, side("Trùng Tên"), null)], knownPlayers, { "7:WHITE": "CREATE" }).targetsByChoiceKey.get("7:WHITE")).toEqual({ kind: "CREATE", newPlayerKey: "chosen-new:7:WHITE" });
  });

  it("flags duplicate boards, a player on two boards, and one ID used with two names", () => {
    const { issues } = resolveImportedPlayers(
      [
        row(7, 1, side("Kỳ Thủ A", "1"), side("Kỳ Thủ B", "2")),
        row(8, 1, side("Kỳ Thủ C", "3"), side("Kỳ Thủ D", "4")),
        row(9, 2, side("Kỳ Thủ A", "1"), side("Kỳ Thủ E", "5")),
        row(10, 3, side("Tên Khác", "2"), side("Kỳ Thủ F", "6")),
      ],
      [],
      {},
    );
    expect(issues.map((issue) => [issue.rowNumber, issue.code, issue.details?.otherRowNumber])).toEqual([
      [8, "DUPLICATE_BOARD", 7],
      [9, "PLAYER_ON_TWO_BOARDS", 7],
      [10, "PLAYER_ID_NAME_MISMATCH", 7],
    ]);
  });
});

describe("computeRoundDiff (SRS-IMP-09)", () => {
  const existing = (boardNumber: number, whitePlayerId: string, blackPlayerId: string | null, hasResult = false, hasResultHistory = false) => ({
    boardNumber, whitePlayerId, blackPlayerId, whitePointsBefore: 0, blackPointsBefore: 0, hasResult, hasResultHistory,
  });

  it("classifies boards and requires a second confirmation when boards with results change", () => {
    const diff = computeRoundDiff(
      [
        { boardNumber: 1, whiteTargetKey: "existing:a", blackTargetKey: "existing:b", whitePointsBefore: 0, blackPointsBefore: 0 },
        { boardNumber: 2, whiteTargetKey: "existing:c", blackTargetKey: "name:new", whitePointsBefore: 0, blackPointsBefore: 0 },
        { boardNumber: 3, whiteTargetKey: "existing:e", blackTargetKey: "existing:f", whitePointsBefore: 1, blackPointsBefore: 0 },
        { boardNumber: 5, whiteTargetKey: "name:x", blackTargetKey: null, whitePointsBefore: null, blackPointsBefore: null },
      ],
      [existing(1, "a", "b", true), existing(2, "c", "d", true), existing(3, "e", "f"), existing(4, "g", "h")],
    );
    expect(diff.entries.map((entry) => [entry.boardNumber, entry.kind, entry.hasResult])).toEqual([
      [1, "UNCHANGED", true],
      [2, "PLAYERS_CHANGED", true],
      [3, "POINTS_CHANGED", false],
      [4, "REMOVED", false],
      [5, "ADDED", false],
    ]);
    expect(diff.requiresResultReplacementConfirmation).toBe(true);
    expect(diff.hasBlockedEntries).toBe(false);
  });

  it("blocks removing a board with result history", () => {
    const diff = computeRoundDiff([], [existing(1, "a", "b", false, true)]);
    expect(diff.entries[0]).toMatchObject({ kind: "REMOVED", isBlocked: true });
    expect(diff.hasBlockedEntries).toBe(true);
  });
});
