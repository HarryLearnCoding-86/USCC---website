// src/server/domain/game-search-filter.ts
// Pure matching of a game against the round-list search box and status filter (SRS-LOOK-02, SRS-LOOK-03):
// an all-digit query matches the board number or a player ID exactly (so typing "2" finds board 2, not every
// ID containing a 2); any other text matches player names ignoring case and Vietnamese diacritics, or IDs.

import type { ResultStatus } from "@prisma/client";
import { normalizeSearchText } from "@/server/domain/search-text-normalizer";

/** The searchable parts of a game. */
export interface SearchableGame {
  boardNumber: number;
  white: { swissManagerPlayerId: string | null; fullName: string };
  black: { swissManagerPlayerId: string | null; fullName: string } | null;
  result: { status: ResultStatus };
}

/**
 * Whether a game matches the search text and optional status filter.
 *
 * @param game - Game to test.
 * @param searchText - Raw text from the search box; empty matches everything.
 * @param statusFilter - Status to keep, or undefined for all.
 * @returns true when the game should be listed.
 */
export function doesGameMatchSearch(game: SearchableGame, searchText: string, statusFilter?: ResultStatus): boolean {
  if (statusFilter && game.result.status !== statusFilter) {
    return false;
  }
  const normalizedQuery = normalizeSearchText(searchText);
  if (normalizedQuery === "") {
    return true;
  }
  const players = game.black ? [game.white, game.black] : [game.white];
  if (/^\d+$/.test(normalizedQuery)) {
    return game.boardNumber === Number(normalizedQuery) || players.some((player) => player.swissManagerPlayerId === normalizedQuery);
  }
  return players.some(
    (player) =>
      normalizeSearchText(player.fullName).includes(normalizedQuery) ||
      (player.swissManagerPlayerId !== null && normalizeSearchText(player.swissManagerPlayerId).includes(normalizedQuery)),
  );
}
