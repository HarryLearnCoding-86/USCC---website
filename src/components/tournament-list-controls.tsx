// src/components/tournament-list-controls.tsx
// Search box, sort choice and pager shared by the home page and /tournaments. A plain GET form and links, so the
// list works without client code and every view (search, order, page) has its own shareable URL.

import Link from "next/link";
import { vi } from "@/i18n/vi";
import { TOURNAMENT_LIST_PAGE_SIZE, TOURNAMENT_SORT_OPTIONS, type TournamentListQuery } from "@/server/domain/tournament-list-rules";

/**
 * Builds a list URL that keeps the search and order.
 *
 * @param basePath - Page path, e.g. "/tournaments".
 * @param listQuery - Current search and order.
 * @param pageNumber - Page to link to.
 * @returns The URL with only non-default parameters.
 */
function buildTournamentListHref(basePath: string, listQuery: TournamentListQuery, pageNumber: number): string {
  const queryParameters = new URLSearchParams();
  if (listQuery.searchText !== "") queryParameters.set("q", listQuery.searchText);
  queryParameters.set("sort", listQuery.sortOption);
  if (pageNumber > 1) queryParameters.set("page", String(pageNumber));
  return `${basePath}?${queryParameters.toString()}`;
}

/**
 * Search and sort form. Submitting starts again at page 1.
 *
 * @param props.basePath - Page path the form submits to.
 * @param props.listQuery - Current values.
 * @returns The form.
 */
export function TournamentListFilterForm({ basePath, listQuery }: { basePath: string; listQuery: TournamentListQuery }) {
  const controlClassName = "min-h-[44px] rounded-md border border-gray-300 px-3";
  return (
    <form method="GET" action={basePath} role="search" className="mb-4 flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-3 sm:flex-row sm:items-end">
      {/* Labels point at their controls with htmlFor instead of wrapping them, so the option texts of the sort
          list (e.g. "Tên giải (A–Z)") do not become part of a label and clash with other fields' names. */}
      <div className="flex flex-1 flex-col gap-1 text-sm">
        <label htmlFor="tournament-list-search">{vi.tournamentList.searchLabel}</label>
        <input id="tournament-list-search" type="search" name="q" defaultValue={listQuery.searchText} placeholder={vi.tournamentList.searchPlaceholder} maxLength={100} className={controlClassName} />
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor="tournament-list-sort">{vi.tournamentList.sortLabel}</label>
        <select id="tournament-list-sort" name="sort" defaultValue={listQuery.sortOption} className={controlClassName}>
          {TOURNAMENT_SORT_OPTIONS.map((sortOption) => (
            <option key={sortOption} value={sortOption}>{vi.tournamentList.sortOptions[sortOption]}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary min-h-[44px]">{vi.tournamentList.applyButton}</button>
        <Link href={basePath} className="btn-secondary inline-flex min-h-[44px] items-center">{vi.tournamentList.clearLink}</Link>
      </div>
    </form>
  );
}

/**
 * "Tournaments x–y of n" and previous/next links.
 *
 * @param props.basePath - Page path for the links.
 * @param props.listQuery - Current search and order.
 * @param props.pageNumber - Current (clamped) page.
 * @param props.pageCount - Number of pages.
 * @param props.matchingCount - Tournaments matching the search.
 * @returns The pager, or the "no matches" text.
 */
export function TournamentListPager({
  basePath,
  listQuery,
  pageNumber,
  pageCount,
  matchingCount,
}: {
  basePath: string;
  listQuery: TournamentListQuery;
  pageNumber: number;
  pageCount: number;
  matchingCount: number;
}) {
  if (matchingCount === 0) return <p className="text-gray-600">{vi.tournamentList.noMatches}</p>;
  const firstNumber = (pageNumber - 1) * TOURNAMENT_LIST_PAGE_SIZE + 1;
  const lastNumber = Math.min(pageNumber * TOURNAMENT_LIST_PAGE_SIZE, matchingCount);
  const pagerLinkClassName = "btn-secondary inline-flex min-h-[44px] items-center";
  return (
    <nav aria-label={vi.tournamentList.pageStatus(pageNumber, pageCount)} className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm" data-testid="tournament-list-pager">
      <span className="text-gray-600">{vi.tournamentList.shownRange(firstNumber, lastNumber, matchingCount)}</span>
      {pageCount > 1 && (
        <span className="flex items-center gap-2">
          {pageNumber > 1 && <Link href={buildTournamentListHref(basePath, listQuery, pageNumber - 1)} className={pagerLinkClassName}>{vi.tournamentList.previousPage}</Link>}
          <span>{vi.tournamentList.pageStatus(pageNumber, pageCount)}</span>
          {pageNumber < pageCount && <Link href={buildTournamentListHref(basePath, listQuery, pageNumber + 1)} className={pagerLinkClassName}>{vi.tournamentList.nextPage}</Link>}
        </span>
      )}
    </nav>
  );
}
