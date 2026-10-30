// src/server/domain/result-display.ts
// Display rules for scores and results: ½ is stored as 0.5 and rendered as "½" (CLAUDE.md §3),
// and a result is restated as "1 – 0" next to its Vietnamese label (SRS-RES-03). Pure; shared by client and server.

/**
 * Formats a score in 0.5 steps with the ½ glyph.
 *
 * @param score - 0, 0.5, 1, 1.5, … (points before a round may exceed 1).
 * @returns "0", "½", "1", "1½", …
 */
export function formatScore(score: number): string {
  const wholePoints = Math.floor(score);
  const hasHalfPoint = Math.abs(score - wholePoints - 0.5) < 1e-9;
  if (!hasHalfPoint) {
    return String(Math.round(score));
  }
  return wholePoints === 0 ? "½" : `${wholePoints}½`;
}

/**
 * Formats a game score as "White – Black".
 *
 * @param whiteScore - Points for White.
 * @param blackScore - Points for Black.
 * @returns e.g. "1 – 0", "½ – ½".
 */
export function formatScoreLine(whiteScore: number, blackScore: number): string {
  return `${formatScore(whiteScore)} – ${formatScore(blackScore)}`;
}
