// src/server/domain/game-winner.ts
// Decides who won a game from its result code's scores, so exports and screens name the winner instead of leaving
// the TD to read "1 – 0" against the colours (FR-09 export, FR-07 projection). Pure; shared by client and server.
// A bye is never reported as a win over an opponent, and a double forfeit has no winner.

/** Outcome of one game. NO_RESULT = no result code yet. */
export type GameOutcome = "WHITE_WINS" | "BLACK_WINS" | "DRAW" | "NO_WINNER" | "BYE" | "NO_RESULT";

/** Side that won, when there is one. */
export type WinningSide = "WHITE" | "BLACK";

/**
 * Determines the outcome of a game.
 *
 * @param gameScores - Scores of the stored result code (null when no code yet) and whether the game has a Black player.
 * @returns WHITE_WINS / BLACK_WINS when one side scored more; DRAW when both scored the same and more than 0;
 *   NO_WINNER when both scored 0 (double forfeit); BYE when there is no Black player; NO_RESULT without a code.
 */
export function determineGameOutcome(gameScores: { whiteScore: number | null; blackScore: number | null; hasBlackPlayer: boolean }): GameOutcome {
  if (!gameScores.hasBlackPlayer) return "BYE";
  const { whiteScore, blackScore } = gameScores;
  if (whiteScore === null || blackScore === null) return "NO_RESULT";
  if (whiteScore > blackScore) return "WHITE_WINS";
  if (blackScore > whiteScore) return "BLACK_WINS";
  return whiteScore > 0 ? "DRAW" : "NO_WINNER";
}

/**
 * The winning side of an outcome.
 *
 * @param gameOutcome - Outcome from determineGameOutcome.
 * @returns WHITE or BLACK, or null for draws, byes, double forfeits and games without a result.
 */
export function selectWinningSide(gameOutcome: GameOutcome): WinningSide | null {
  if (gameOutcome === "WHITE_WINS") return "WHITE";
  if (gameOutcome === "BLACK_WINS") return "BLACK";
  return null;
}
