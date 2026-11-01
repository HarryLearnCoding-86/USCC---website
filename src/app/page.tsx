// src/app/page.tsx
// Home page for both roles: tournaments with links to each round's pairing list (SRS-LOOK-04: list → game → entry),
// plus console and settings links for the TD. Searchable, sortable (newest first by default), 15 per page.

import Link from "next/link";
import { vi } from "@/i18n/vi";
import { requirePageUser } from "@/server/auth/page-guards";
import { hasPermission } from "@/server/auth/role-permissions";
import { queryTournamentList } from "@/server/services/tournament-query-service";
import { parseTournamentListQuery } from "@/server/validation/tournament-list-query-schema";
import { AppHeader } from "@/components/app-header";
import { TournamentListFilterForm, TournamentListPager } from "@/components/tournament-list-controls";

/**
 * Home page.
 *
 * @param props.searchParams - ?q= search, ?sort= order, ?page= page number.
 * @returns One page of tournaments with their dates, venue and round numbers.
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const signedInUser = await requirePageUser("LOOK_UP_GAMES");
  const listQuery = parseTournamentListQuery(await searchParams);
  const tournamentPage = await queryTournamentList(listQuery);
  const hasNoTournamentsAtAll = tournamentPage.matchingCount === 0 && listQuery.searchText === "";
  const isTechnical = hasPermission(signedInUser.role, "MANAGE_TOURNAMENTS");
  return (
    <>
      <AppHeader signedInUser={signedInUser} />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-4 text-2xl font-semibold">{vi.home.pageTitle}</h1>
        <TournamentListFilterForm basePath="/" listQuery={listQuery} />
        {hasNoTournamentsAtAll && <p className="text-gray-600">{vi.home.noTournaments}</p>}
        <ul className="flex flex-col gap-3" data-testid="tournament-list">
          {tournamentPage.items.map((tournament) => (
            <li key={tournament.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="text-lg font-semibold">{tournament.name}</h2>
              <p className="text-sm text-gray-600">
                {vi.home.dateRange(tournament.startDateText, tournament.endDateText)}
                {tournament.venue ? ` · ${tournament.venue}` : ""}
              </p>
              <p className="text-xs text-gray-500">{vi.tournamentList.gameCounts(tournament.winCount, tournament.drawCount)}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-sm">
                {tournament.roundNumbers.length === 0 && <span className="text-gray-500">{vi.home.noRounds}</span>}
                {tournament.roundNumbers.map((roundNumber) => (
                  <Link
                    key={roundNumber}
                    href={`/tournaments/${tournament.id}/rounds/${roundNumber}`}
                    className="inline-flex min-h-[44px] items-center rounded bg-gray-100 px-3 hover:bg-gray-200"
                  >
                    {vi.home.roundLink(roundNumber)}
                  </Link>
                ))}
                {isTechnical && (
                  <>
                    <Link href={`/tournaments/${tournament.id}/console`} className="btn-secondary inline-flex min-h-[44px] items-center">
                      {vi.home.consoleLink}
                    </Link>
                    <Link href={`/tournaments/${tournament.id}/settings`} className="btn-secondary inline-flex min-h-[44px] items-center">
                      {vi.home.settingsLink}
                    </Link>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
        {!hasNoTournamentsAtAll && (
          <TournamentListPager basePath="/" listQuery={listQuery} pageNumber={tournamentPage.pageNumber} pageCount={tournamentPage.pageCount} matchingCount={tournamentPage.matchingCount} />
        )}
      </main>
    </>
  );
}
