// src/server/validation/tournament-list-query-schema.ts
// Parses the tournament list's URL query (?q=&sort=&page=). Lenient on purpose: a hand-edited or stale link falls
// back to the defaults (no search, newest first, page 1) instead of showing an error page.

import { z } from "zod";
import { DEFAULT_TOURNAMENT_SORT_OPTION, TOURNAMENT_SORT_OPTIONS, type TournamentListQuery } from "@/server/domain/tournament-list-rules";

/** Longest search text kept; longer input is cut, not rejected. */
const MAX_SEARCH_TEXT_LENGTH = 100;

const tournamentListQuerySchema = z.object({
  q: z.string().catch("").transform((searchText) => searchText.slice(0, MAX_SEARCH_TEXT_LENGTH)),
  sort: z.enum(TOURNAMENT_SORT_OPTIONS).catch(DEFAULT_TOURNAMENT_SORT_OPTION),
  page: z.coerce.number().int().min(1).catch(1),
});

/**
 * Reads the list query from Next.js search params.
 *
 * @param searchParams - The page's search params; repeated keys use their first value.
 * @returns Search text, sort option and page number, with defaults for anything missing or invalid.
 */
export function parseTournamentListQuery(searchParams: Record<string, string | string[] | undefined>): TournamentListQuery {
  const firstValue = (key: string) => {
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const parsedQuery = tournamentListQuerySchema.parse({ q: firstValue("q"), sort: firstValue("sort"), page: firstValue("page") });
  return { searchText: parsedQuery.q, sortOption: parsedQuery.sort, pageNumber: parsedQuery.page };
}
