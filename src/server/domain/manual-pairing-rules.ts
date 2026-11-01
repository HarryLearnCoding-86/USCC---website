// src/server/domain/manual-pairing-rules.ts
// Validation for one manually entered board (SRS-IMP-13 applies the SRS-IMP-06 checks), and player resolution
// by Swiss-Manager ID first, exact normalized name second, never auto-merging (RULE-02, SRS-IMP-08).
// Pure: callers pass the round's other games and the tournament's players.

import { normalizePlayerNameForMatching } from "@/server/domain/search-text-normalizer";

/** One side of a board as typed by the TD. */
export interface ManualPairingSideInput {
  swissManagerPlayerId: string | null;
  fullName: string;
  clubOrFederation: string | null;
  pointsBefore: number | null;
}

/** An existing player of the tournament. */
export interface KnownPlayer {
  id: string;
  swissManagerPlayerId: string | null;
  fullName: string;
}

/** How one side resolves to a player record. */
export type PlayerResolution =
  | { kind: "EXISTING"; playerId: string }
  | { kind: "CREATE" }
  | { kind: "ID_NAME_MISMATCH"; existingName: string }
  | { kind: "AMBIGUOUS_NAME"; matchCount: number };

/** Another board already in the round, with the players it uses. */
export interface OtherBoardInRound {
  boardNumber: number;
  playerIds: string[];
}

/** Validation problems for a board, each tied to a field so the UI can point at it. */
export type ManualPairingProblem =
  | { field: "boardNumber"; code: "BOARD_NOT_POSITIVE_INTEGER" }
  | { field: "white" | "black"; code: "PLAYER_ID_NAME_MISMATCH"; existingName: string }
  | { field: "white" | "black"; code: "AMBIGUOUS_PLAYER_NAME"; matchCount: number }
  | { field: "white" | "black"; code: "PLAYER_ON_ANOTHER_BOARD"; otherBoardNumber: number }
  | { field: "black"; code: "SAME_PLAYER_BOTH_SIDES" };

/**
 * Resolves a typed side to an existing player, a new player, or a conflict.
 * SRS-IMP-08: ID first; a name with no ID matches only when exactly one player has that exact normalized name.
 *
 * @param sideInput - The side as typed.
 * @param knownPlayers - All players of the tournament.
 * @returns The resolution.
 */
export function resolvePlayerForSide(sideInput: ManualPairingSideInput, knownPlayers: readonly KnownPlayer[]): PlayerResolution {
  const typedName = normalizePlayerNameForMatching(sideInput.fullName);
  if (sideInput.swissManagerPlayerId) {
    const playerWithId = knownPlayers.find((player) => player.swissManagerPlayerId === sideInput.swissManagerPlayerId);
    if (!playerWithId) {
      return { kind: "CREATE" };
    }
    // SRS-IMP-06: an ID that belongs to a differently named player is an error, never a silent rename.
    return normalizePlayerNameForMatching(playerWithId.fullName) === typedName
      ? { kind: "EXISTING", playerId: playerWithId.id }
      : { kind: "ID_NAME_MISMATCH", existingName: playerWithId.fullName };
  }
  const nameMatches = knownPlayers.filter((player) => normalizePlayerNameForMatching(player.fullName) === typedName);
  if (nameMatches.length === 0) {
    return { kind: "CREATE" };
  }
  const [onlyMatch] = nameMatches;
  return nameMatches.length === 1 && onlyMatch
    ? { kind: "EXISTING", playerId: onlyMatch.id }
    : { kind: "AMBIGUOUS_NAME", matchCount: nameMatches.length };
}

/**
 * Validates one board before it is saved.
 *
 * @param boardNumber - Board number typed by the TD.
 * @param resolutions - Resolution of White and (unless bye) Black.
 * @param otherBoards - The round's other boards (excluding the one being edited).
 * @returns Every problem found; empty when the board can be saved.
 */
export function validateManualPairing(
  boardNumber: number,
  resolutions: { white: PlayerResolution; black: PlayerResolution | null },
  otherBoards: readonly OtherBoardInRound[],
): ManualPairingProblem[] {
  const problems: ManualPairingProblem[] = [];
  if (!Number.isInteger(boardNumber) || boardNumber < 1) {
    problems.push({ field: "boardNumber", code: "BOARD_NOT_POSITIVE_INTEGER" });
  }
  for (const side of ["white", "black"] as const) {
    const resolution = resolutions[side];
    if (!resolution) continue;
    if (resolution.kind === "ID_NAME_MISMATCH") {
      problems.push({ field: side, code: "PLAYER_ID_NAME_MISMATCH", existingName: resolution.existingName });
    }
    if (resolution.kind === "AMBIGUOUS_NAME") {
      problems.push({ field: side, code: "AMBIGUOUS_PLAYER_NAME", matchCount: resolution.matchCount });
    }
    if (resolution.kind === "EXISTING") {
      // SRS-IMP-06 / SRS §9: a player appears once per round.
      const otherBoard = otherBoards.find((board) => board.playerIds.includes(resolution.playerId));
      if (otherBoard) {
        problems.push({ field: side, code: "PLAYER_ON_ANOTHER_BOARD", otherBoardNumber: otherBoard.boardNumber });
      }
    }
  }
  const { white, black } = resolutions;
  if (white.kind === "EXISTING" && black?.kind === "EXISTING" && white.playerId === black.playerId) {
    problems.push({ field: "black", code: "SAME_PLAYER_BOTH_SIDES" });
  }
  return problems;
}
