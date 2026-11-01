// src/app/page.tsx
// Home page for both roles: tournaments with links to each round's pairing list (SRS-LOOK-04: list → game → entry),
// plus console and settings links for the TD.

import Link from "next/link";
import { vi } from "@/i18n/vi";
import { requirePageUser } from "@/server/auth/page-guards";
import { hasPermission } from "@/server/auth/role-permissions";
import { listTournamentsWithRounds } from "@/server/services/tournament-query-service";
import { AppHeader } from "@/components/app-header";

/**
 * Home page.
 *
 * @returns Tournaments with their dates, venue and round numbers.
 */
export default async function HomePage() {
  const signedInUser = await requirePageUser("LOOK_UP_GAMES");
  const tournaments = await listTournamentsWithRounds();
  const isTechnical = hasPermission(signedInUser.role, "MANAGE_TOURNAMENTS");
  return (
    <>
      <AppHeader signedInUser={signedInUser} />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-4 text-2xl font-semibold">{vi.home.pageTitle}</h1>
        {tournaments.length === 0 && <p className="text-gray-600">{vi.home.noTournaments}</p>}
        <ul className="flex flex-col gap-3">
          {tournaments.map((tournament) => (
            <li key={tournament.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="text-lg font-semibold">{tournament.name}</h2>
              <p className="text-sm text-gray-600">
                {vi.home.dateRange(tournament.startDateText, tournament.endDateText)}
                {tournament.venue ? ` · ${tournament.venue}` : ""}
              </p>
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
      </main>
    </>
  );
}
