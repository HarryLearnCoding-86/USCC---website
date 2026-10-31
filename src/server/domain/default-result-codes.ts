// src/server/domain/default-result-codes.ts
// The proposed default result-code list seeded into every new tournament (SRS-TOUR-06).
// The final list and the Swiss-Manager values are open question OI-03: the TD must confirm or adjust
// them before round 1. Labels come from src/i18n/vi.ts so no Vietnamese text lives here.

import { vi } from "@/i18n/vi";

/** Shape of one default result code before it is attached to a tournament. */
export interface DefaultResultCodeDefinition {
  /** Short stable code shown to arbiters, e.g. "1-0". */
  code: string;
  /** Vietnamese label from vi.ts. */
  labelVi: string;
  /** Points for White: 0, 0.5 or 1. */
  whiteScore: number;
  /** Points for Black: 0, 0.5 or 1 (0 for byes, which have no Black player). */
  blackScore: number;
  /** false when the code does not involve two players at the board (SRS-SM-04, RULE-06). */
  requiresPlayerConfirmation: boolean;
  /** Proposed Swiss-Manager value; placeholder until OI-03 is resolved. */
  swissManagerValue: string;
  /** Display order on the entry screen, ascending. */
  sortOrder: number;
}

const labels = vi.defaultResultCodeLabels;

/**
 * Default result codes per SRS-TOUR-06.
 *
 * Assumption (OI-03/OI-04, documented in README): forfeits and byes do not require player confirmation,
 * because at least one player is absent from the board and a two-player confirmation is impossible.
 * Such codes are submitted by the TD and go straight to OFFICIAL; they are never shown as
 * "confirmed by both players".
 */
export const DEFAULT_RESULT_CODES: readonly DefaultResultCodeDefinition[] = [
  { code: "1-0", labelVi: labels.whiteWins, whiteScore: 1, blackScore: 0, requiresPlayerConfirmation: true, swissManagerValue: "1-0", sortOrder: 1 },
  { code: "0-1", labelVi: labels.blackWins, whiteScore: 0, blackScore: 1, requiresPlayerConfirmation: true, swissManagerValue: "0-1", sortOrder: 2 },
  { code: "½-½", labelVi: labels.draw, whiteScore: 0.5, blackScore: 0.5, requiresPlayerConfirmation: true, swissManagerValue: "½-½", sortOrder: 3 },
  { code: "+/-", labelVi: labels.whiteWinsByForfeit, whiteScore: 1, blackScore: 0, requiresPlayerConfirmation: false, swissManagerValue: "+/-", sortOrder: 4 },
  { code: "-/+", labelVi: labels.blackWinsByForfeit, whiteScore: 0, blackScore: 1, requiresPlayerConfirmation: false, swissManagerValue: "-/+", sortOrder: 5 },
  { code: "-/-", labelVi: labels.doubleForfeit, whiteScore: 0, blackScore: 0, requiresPlayerConfirmation: false, swissManagerValue: "-/-", sortOrder: 6 },
  { code: "BYE", labelVi: labels.fullPointBye, whiteScore: 1, blackScore: 0, requiresPlayerConfirmation: false, swissManagerValue: "+", sortOrder: 7 },
  { code: "BYE½", labelVi: labels.halfPointBye, whiteScore: 0.5, blackScore: 0, requiresPlayerConfirmation: false, swissManagerValue: "½", sortOrder: 8 },
  { code: "BYE0", labelVi: labels.zeroPointBye, whiteScore: 0, blackScore: 0, requiresPlayerConfirmation: false, swissManagerValue: "-", sortOrder: 9 },
];
