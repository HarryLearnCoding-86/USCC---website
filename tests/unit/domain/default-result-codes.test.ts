// tests/unit/domain/default-result-codes.test.ts
// Unit tests for the proposed default result codes (SRS-TOUR-06, RULE-04, RULE-06).

import { describe, expect, it } from "vitest";
import { DEFAULT_RESULT_CODES } from "@/server/domain/default-result-codes";

describe("DEFAULT_RESULT_CODES (SRS-TOUR-06)", () => {
  it("contains the nine SRS default codes with unique codes and sort orders", () => {
    expect(DEFAULT_RESULT_CODES.map((resultCode) => resultCode.code)).toEqual([
      "1-0", "0-1", "½-½", "+/-", "-/+", "-/-", "BYE", "BYE½", "BYE0",
    ]);
    expect(new Set(DEFAULT_RESULT_CODES.map((resultCode) => resultCode.sortOrder)).size).toBe(9);
  });

  it("uses only scores 0, 0.5 and 1 (SRS §9)", () => {
    for (const resultCode of DEFAULT_RESULT_CODES) {
      expect([0, 0.5, 1]).toContain(resultCode.whiteScore);
      expect([0, 0.5, 1]).toContain(resultCode.blackScore);
    }
  });

  it("requires player confirmation only for games played at the board (RULE-06)", () => {
    const codesNeedingConfirmation = DEFAULT_RESULT_CODES.filter((resultCode) => resultCode.requiresPlayerConfirmation)
      .map((resultCode) => resultCode.code);
    expect(codesNeedingConfirmation).toEqual(["1-0", "0-1", "½-½"]);
  });

  it("has a Vietnamese label for every code", () => {
    for (const resultCode of DEFAULT_RESULT_CODES) {
      expect(resultCode.labelVi.length).toBeGreaterThan(0);
    }
  });
});
