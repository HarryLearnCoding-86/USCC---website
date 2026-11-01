// src/server/domain/tournament-list-rules.ts
// Search, sort and paging rules for the tournament lists (home page and /tournaments). Pure, so the same rules
// are unit-tested without a database. Lists are small at club scale (tens to a few hundred tournaments), so the
// service loads them once and these rules filter, sort and cut the page in memory.

import { normalizeSearchText } from "@/server/domain/search-text-normalizer";

/** Number of tournaments shown per page. */
export const TOURNAMENT_LIST_PAGE_SIZE = 15;

/** Sort options. Date (newest first) is the default. */
export const TOURNAMENT_SORT_OPTIONS = ["date-desc", "date-asc", "name-asc", "id-asc", "wins-desc", "draws-desc"] as const;
export type TournamentSortOption = (typeof TOURNAMENT_SORT_OPTIONS)[number];
export const DEFAULT_TOURNAMENT_SORT_OPTION: TournamentSortOption = "date-desc";

/** Fields the rules need from each tournament. */
export interface TournamentListFields {
  id: string;
  name: string;
  venue: string | null;
  organizer: string | null;
  /** Start date as YYYY-MM-DD, so text order is date order. */
  startDateIso: string;
  /** Official games with a winner, forfeit wins included; byes are not games. */
  winCount: number;
  /** Official drawn games. */
  drawCount: number;
}

/** What the viewer asked for. */
export interface TournamentListQuery {
  searchText: string;
  sortOption: TournamentSortOption;
  /** 1-based; clamped to the last page. */
  pageNumber: number;
}

/** One page of the list. */
export interface TournamentListPage<TournamentItem> {
  items: TournamentItem[];
  /** Tournaments matching the search, across all pages. */
  matchingCount: number;
  pageNumber: number;
  pageCount: number;
}

/**
 * Whether a tournament matches the search: name, venue or organizer, ignoring case and Vietnamese diacritics.
 *
 * @param tournament - The tournament.
 * @param searchText - Viewer's text; empty matches everything.
 * @returns True when every word of the search appears in the tournament's text.
 */
export function doesTournamentMatchSearch(tournament: TournamentListFields, searchText: string): boolean {
  const searchWords = normalizeSearchText(searchText).split(" ").filter((searchWord) => searchWord !== "");
  if (searchWords.length === 0) return true;
  const tournamentText = normalizeSearchText([tournament.name, tournament.venue ?? "", tournament.organizer ?? ""].join(" "));
  return searchWords.every((searchWord) => tournamentText.includes(searchWord));
}

/**
 * Compares two tournaments for a sort option. Ties fall back to newest date, then name, then ID, so the order
 * is stable and every page boundary is predictable.
 *
 * @param first - A tournament.
 * @param second - Another tournament.
 * @param sortOption - The chosen order.
 * @returns Negative when first comes before second.
 */
export function compareTournaments(first: TournamentListFields, second: TournamentListFields, sortOption: TournamentSortOption): number {
  const byNewestDate = second.startDateIso.localeCompare(first.startDateIso);
  const byName = first.name.localeCompare(second.name, "vi");
  const byId = first.id.localeCompare(second.id);
  const tieBreak = byNewestDate || byName || byId;
  switch (sortOption) {
    case "date-desc":
      return tieBreak;
    case "date-asc":
      return first.startDateIso.localeCompare(second.startDateIso) || byName || byId;
    case "name-asc":
      return byName || tieBreak;
    case "id-asc":
      return byId;
    case "wins-desc":
      return second.winCount - first.winCount || tieBreak;
    case "draws-desc":
      return second.drawCount - first.drawCount || tieBreak;
  }
}

/**
 * Filters, sorts and cuts one page.
 *
 * @param tournaments - Every tournament.
 * @param listQuery - Search, sort and page.
 * @returns The page, with counts for the pager.
 */
export function selectTournamentListPage<TournamentItem extends TournamentListFields>(
  tournaments: TournamentItem[],
  listQuery: TournamentListQuery,
): TournamentListPage<TournamentItem> {
  const matchingTournaments = tournaments
    .filter((tournament) => doesTournamentMatchSearch(tournament, listQuery.searchText))
    .sort((first, second) => compareTournaments(first, second, listQuery.sortOption));
  const pageCount = Math.max(1, Math.ceil(matchingTournaments.length / TOURNAMENT_LIST_PAGE_SIZE));
  const pageNumber = Math.min(Math.max(1, Math.floor(listQuery.pageNumber)), pageCount);
  const firstIndex = (pageNumber - 1) * TOURNAMENT_LIST_PAGE_SIZE;
  return {
    items: matchingTournaments.slice(firstIndex, firstIndex + TOURNAMENT_LIST_PAGE_SIZE),
    matchingCount: matchingTournaments.length,
    pageNumber,
    pageCount,
  };
}
