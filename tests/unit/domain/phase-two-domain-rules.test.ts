// tests/unit/domain/phase-two-domain-rules.test.ts
// Unit tests for score display (½), diacritic-insensitive search (SRS-LOOK-02), tournament rules
// (SRS-TOUR-01, 03) and manual pairing validation / player resolution (SRS-IMP-06, 08, 13).

import { describe, expect, it } from "vitest";
import { formatScore, formatScoreLine } from "@/server/domain/result-display";
import { normalizePlayerNameForMatching, normalizeSearchText } from "@/server/domain/search-text-normalizer";
import { computeContrastRatio, hasLowContrastWithWhiteText, isValidTimezone } from "@/server/domain/tournament-rules";
import { resolvePlayerForSide, validateManualPairing, type KnownPlayer } from "@/server/domain/manual-pairing-rules";
import { doesGameMatchSearch } from "@/server/domain/game-search-filter";

describe("formatScore", () => {
  it.each([
    [0, "0"],
    [0.5, "½"],
    [1, "1"],
    [1.5, "1½"],
    [3.5, "3½"],
  ])("%s → %s", (score, expectedText) => {
    expect(formatScore(score)).toBe(expectedText);
  });

  it("formats a score line", () => {
    expect(formatScoreLine(0.5, 0.5)).toBe("½ – ½");
  });
});

describe("normalizeSearchText (SRS-LOOK-02)", () => {
  it("matches names regardless of case, diacritics, đ and spacing", () => {
    expect(normalizeSearchText("Nguyễn  Văn   Ân")).toBe("nguyen van an");
    expect(normalizeSearchText("Đặng Thị Phương")).toBe("dang thi phuong");
    expect(normalizeSearchText("nguyen van an")).toBe(normalizeSearchText("NGUYỄN VĂN ÂN"));
  });

  it("keeps tone marks for record matching, so different names stay different", () => {
    expect(normalizePlayerNameForMatching("Lê  Văn Cường ")).toBe("lê văn cường");
    expect(normalizePlayerNameForMatching("Lê Văn Cường")).not.toBe(normalizePlayerNameForMatching("Le Van Cuong"));
  });
});

describe("doesGameMatchSearch (SRS-LOOK-02, 03)", () => {
  const game = {
    boardNumber: 12,
    white: { swissManagerPlayerId: "1002", fullName: "Nguyễn Văn Ân" },
    black: { swissManagerPlayerId: "2045", fullName: "Đặng Thị Phương" },
    result: { status: "PENDING" as const },
  };

  it("matches digits against the board or an exact player ID only", () => {
    expect(doesGameMatchSearch(game, "12")).toBe(true);
    expect(doesGameMatchSearch(game, "2045")).toBe(true);
    expect(doesGameMatchSearch(game, "2")).toBe(false);
  });

  it("matches names without diacritics, and respects the status filter", () => {
    expect(doesGameMatchSearch(game, "dang thi")).toBe(true);
    expect(doesGameMatchSearch(game, "", "PENDING")).toBe(true);
    expect(doesGameMatchSearch(game, "nguyen", "OFFICIAL")).toBe(false);
  });

  it("handles a bye game", () => {
    expect(doesGameMatchSearch({ ...game, black: null }, "phuong")).toBe(false);
  });
});

describe("tournament rules", () => {
  it("accepts IANA timezones and rejects junk", () => {
    expect(isValidTimezone("Asia/Ho_Chi_Minh")).toBe(true);
    expect(isValidTimezone("Mars/Base")).toBe(false);
  });

  it("computes WCAG contrast and warns below 4.5:1 (SRS-TOUR-03)", () => {
    expect(computeContrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(hasLowContrastWithWhiteText("#1d4ed8")).toBe(false);
    expect(hasLowContrastWithWhiteText("#f59e0b")).toBe(true);
  });
});

describe("manual pairing rules (SRS-IMP-06, SRS-IMP-08)", () => {
  const knownPlayers: KnownPlayer[] = [
    { id: "p1", swissManagerPlayerId: "1001", fullName: "Nguyễn Văn An" },
    { id: "p2", swissManagerPlayerId: null, fullName: "Trần Bình" },
    { id: "p3", swissManagerPlayerId: null, fullName: "Lê Hoa" },
    { id: "p4", swissManagerPlayerId: "1004", fullName: "Lê Hoa" },
  ];
  const side = (swissManagerPlayerId: string | null, fullName: string) => ({ swissManagerPlayerId, fullName, clubOrFederation: null, pointsBefore: null });

  it("resolves by ID first, then by a unique exact name, else creates", () => {
    expect(resolvePlayerForSide(side("1001", "nguyễn văn an "), knownPlayers)).toEqual({ kind: "EXISTING", playerId: "p1" });
    expect(resolvePlayerForSide(side(null, "Trần  Bình"), knownPlayers)).toEqual({ kind: "EXISTING", playerId: "p2" });
    expect(resolvePlayerForSide(side("2000", "Người Mới"), knownPlayers)).toEqual({ kind: "CREATE" });
    expect(resolvePlayerForSide(side(null, "Người Mới"), knownPlayers)).toEqual({ kind: "CREATE" });
  });

  it("never auto-merges: an ID with a different name or an ambiguous name is a conflict", () => {
    expect(resolvePlayerForSide(side("1001", "Someone Else"), knownPlayers)).toEqual({ kind: "ID_NAME_MISMATCH", existingName: "Nguyễn Văn An" });
    expect(resolvePlayerForSide(side(null, "Lê Hoa"), knownPlayers)).toEqual({ kind: "AMBIGUOUS_NAME", matchCount: 2 });
  });

  it("flags bad board numbers, players on two boards and the same player on both sides", () => {
    const otherBoards = [{ boardNumber: 2, playerIds: ["p2"] }];
    expect(validateManualPairing(0, { white: { kind: "CREATE" }, black: null }, [])).toEqual([{ field: "boardNumber", code: "BOARD_NOT_POSITIVE_INTEGER" }]);
    expect(validateManualPairing(1, { white: { kind: "EXISTING", playerId: "p2" }, black: { kind: "CREATE" } }, otherBoards)).toEqual([
      { field: "white", code: "PLAYER_ON_ANOTHER_BOARD", otherBoardNumber: 2 },
    ]);
    expect(validateManualPairing(1, { white: { kind: "EXISTING", playerId: "p1" }, black: { kind: "EXISTING", playerId: "p1" } }, [])).toEqual([
      { field: "black", code: "SAME_PLAYER_BOTH_SIDES" },
    ]);
  });

  it("accepts a valid board with an existing and a new player", () => {
    expect(validateManualPairing(3, { white: { kind: "EXISTING", playerId: "p1" }, black: { kind: "CREATE" } }, [{ boardNumber: 2, playerIds: ["p2"] }])).toEqual([]);
  });
});
