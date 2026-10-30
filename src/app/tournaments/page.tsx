// src/app/tournaments/page.tsx
// /tournaments — TD list of tournaments with links to their pages, and the create form (SRS-TOUR-01).

import Link from "next/link";
import { vi } from "@/i18n/vi";
import { requirePageUser } from "@/server/auth/page-guards";
import { listTournamentsWithRounds } from "@/server/services/tournament-query-service";
import { PageShell } from "@/components/page-shell";
import { EMPTY_TOURNAMENT_FORM_VALUES, TournamentForm } from "@/components/tournament-form";

/**
 * Tournament management page.
 *
 * @returns Existing tournaments and the create form; TECHNICAL only.
 */
export default async function TournamentsPage() {
  const signedInUser = await requirePageUser("MANAGE_TOURNAMENTS");
  const tournaments = await listTournamentsWithRounds();
  return (
    <PageShell signedInUser={signedInUser}>
      <h1 className="mb-4 text-2xl font-semibold">{vi.tournaments.pageTitle}</h1>
      <ul className="mb-8 flex flex-col gap-2">
        {tournaments.map((tournament) => (
          <li key={tournament.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white p-3">
            <div>
              <p className="font-medium">{tournament.name}</p>
              <p className="text-sm text-gray-600">{vi.home.dateRange(tournament.startDateText, tournament.endDateText)}</p>
            </div>
            <div className="flex gap-2 text-sm">
              <Link className="btn-secondary min-h-[44px] inline-flex items-center" href={`/tournaments/${tournament.id}/console`}>{vi.home.consoleLink}</Link>
              <Link className="btn-secondary min-h-[44px] inline-flex items-center" href={`/tournaments/${tournament.id}/settings`}>{vi.home.settingsLink}</Link>
            </div>
          </li>
        ))}
      </ul>
      <h2 className="mb-2 text-lg font-semibold">{vi.tournaments.createHeading}</h2>
      <TournamentForm initialValues={EMPTY_TOURNAMENT_FORM_VALUES} />
    </PageShell>
  );
}
