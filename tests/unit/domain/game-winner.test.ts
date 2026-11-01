// tests/unit/domain/game-winner.test.ts
// Unit tests for the winner rule used by exports and screens: every default result code, byes and missing results.

import { describe, expect, it } from "vitest";
import { DEFAULT_RESULT_CODES } from "@/server/domain/default-result-codes";
import { determineGameOutcome, selectWinningSide } from "@/server/domain/game-winner";

describe("determineGameOutcome", () => {
  it("names the side that scored more", () => {
    expect(determineGameOutcome({ whiteScore: 1, blackScore: 0, hasBlackPlayer: true })).toBe("WHITE_WINS");
    expect(determineGameOutcome({ whiteScore: 0, blackScore: 1, hasBlackPlayer: true })).toBe("BLACK_WINS");
  });

  it("treats equal positive scores as a draw and 0–0 as no winner", () => {
    expect(determineGameOutcome({ whiteScore: 0.5, blackScore: 0.5, hasBlackPlayer: true })).toBe("DRAW");
    expect(determineGameOutcome({ whiteScore: 0, blackScore: 0, hasBlackPlayer: true })).toBe("NO_WINNER");
  });

  it("never reports a bye as a win, and reports a game without a code as NO_RESULT", () => {
    expect(determineGameOutcome({ whiteScore: 1, blackScore: 0, hasBlackPlayer: false })).toBe("BYE");
    expect(determineGameOutcome({ whiteScore: null, blackScore: null, hasBlackPlayer: true })).toBe("NO_RESULT");
  });

  it("gives a sensible outcome for every two-player default result code", () => {
    const outcomesByCode = Object.fromEntries(
      DEFAULT_RESULT_CODES.filter((resultCode) => resultCode.requiresPlayerConfirmation || resultCode.code.includes("/")).map((resultCode) => [
        resultCode.code,
        determineGameOutcome({ whiteScore: resultCode.whiteScore, blackScore: resultCode.blackScore, hasBlackPlayer: true }),
      ]),
    );
    expect(outcomesByCode["1-0"]).toBe("WHITE_WINS");
    expect(outcomesByCode["0-1"]).toBe("BLACK_WINS");
    expect(outcomesByCode["½-½"]).toBe("DRAW");
    expect(outcomesByCode["+/-"]).toBe("WHITE_WINS");
    expect(outcomesByCode["-/+"]).toBe("BLACK_WINS");
    expect(outcomesByCode["-/-"]).toBe("NO_WINNER");
  });
});

describe("selectWinningSide", () => {
  it("returns a side only for wins", () => {
    expect(selectWinningSide("WHITE_WINS")).toBe("WHITE");
    expect(selectWinningSide("BLACK_WINS")).toBe("BLACK");
    for (const outcome of ["DRAW", "NO_WINNER", "BYE", "NO_RESULT"] as const) expect(selectWinningSide(outcome)).toBeNull();
  });
});
