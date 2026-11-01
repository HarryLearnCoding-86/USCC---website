// src/app/tournaments/page.tsx
// /tournaments — TD list of tournaments with links to their pages, and the create form (SRS-TOUR-01).
// The list is searchable, sortable (newest first by default) and shows 15 tournaments per page.

import Link from "next/link";
import { vi } from "@/i18n/vi";
import { requirePageUser } from "@/server/auth/page-guards";
import { queryTournamentList } from "@/server/services/tournament-query-service";
import { parseTournamentListQuery } from "@/server/validation/tournament-list-query-schema";
import { PageShell } from "@/components/page-shell";
import { TournamentListFilterForm, TournamentListPager } from "@/components/tournament-list-controls";
import { EMPTY_TOURNAMENT_FORM_VALUES, TournamentForm } from "@/components/tournament-form";

/**
 * Tournament management page.
 *
 * @param props.searchParams - ?q= search, ?sort= order, ?page= page number.
 * @returns One page of tournaments and the create form; TECHNICAL only.
 */
export default async function TournamentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const signedInUser = await requirePageUser("MANAGE_TOURNAMENTS");
  const listQuery = parseTournamentListQuery(await searchParams);
  const tournamentPage = await queryTournamentList(listQuery);
  return (
    <PageShell signedInUser={signedInUser}>
      <h1 className="mb-4 text-2xl font-semibold">{vi.tournaments.pageTitle}</h1>
      <TournamentListFilterForm basePath="/tournaments" listQuery={listQuery} />
      <ul className="flex flex-col gap-2" data-testid="tournament-list">
        {tournamentPage.items.map((tournament) => (
          <li key={tournament.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white p-3">
            <div>
              <p className="font-medium">{tournament.name}</p>
              <p className="text-sm text-gray-600">{vi.home.dateRange(tournament.startDateText, tournament.endDateText)}</p>
              <p className="text-xs text-gray-500">
                {vi.tournamentList.gameCounts(tournament.winCount, tournament.drawCount)} · {vi.tournamentList.tournamentId(tournament.id)}
              </p>
            </div>
            <div className="flex gap-2 text-sm">
              <Link className="btn-secondary min-h-[44px] inline-flex items-center" href={`/tournaments/${tournament.id}/console`}>{vi.home.consoleLink}</Link>
              <Link className="btn-secondary min-h-[44px] inline-flex items-center" href={`/tournaments/${tournament.id}/settings`}>{vi.home.settingsLink}</Link>
            </div>
          </li>
        ))}
      </ul>
      <TournamentListPager basePath="/tournaments" listQuery={listQuery} pageNumber={tournamentPage.pageNumber} pageCount={tournamentPage.pageCount} matchingCount={tournamentPage.matchingCount} />
      <h2 className="mb-2 mt-8 text-lg font-semibold">{vi.tournaments.createHeading}</h2>
      <TournamentForm initialValues={EMPTY_TOURNAMENT_FORM_VALUES} />
    </PageShell>
  );
}
