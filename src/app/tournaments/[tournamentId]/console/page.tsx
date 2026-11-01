// src/app/tournaments/[tournamentId]/console/page.tsx
// /tournaments/[id]/console?round=n — TD console: live statuses, dispute queue, approve/edit/reopen/cancel with
// reason, per-game audit history (SRS-TD-01..05). TECHNICAL only (RESOLVE_RESULTS).

import { vi } from "@/i18n/vi";
import { requirePageUser } from "@/server/auth/page-guards";
import { loadOrNotFound } from "@/server/http/page-data-loaders";
import { getConsoleOverview, getTournamentSummary } from "@/server/services/game-query-service";
import { LiveRefresh } from "@/components/live-refresh";
import { PageShell } from "@/components/page-shell";
import { TechnicalConsole } from "@/components/technical-console";
import { TournamentNavigation } from "@/components/tournament-navigation";

/**
 * Console page.
 *
 * @param props.params - Route params with tournamentId.
 * @param props.searchParams - Optional ?round=n; defaults to the first round.
 * @returns The console for the selected round.
 */
export default async function ConsolePage({
  params,
  searchParams,
}: {
  params: Promise<{ tournamentId: string }>;
  searchParams: Promise<{ round?: string }>;
}) {
  const signedInUser = await requirePageUser("RESOLVE_RESULTS");
  const { tournamentId } = await params;
  const { round } = await searchParams;
  const tournamentSummary = await loadOrNotFound(() => getTournamentSummary(tournamentId));
  const requestedRound = Number(round);
  const roundNumber = tournamentSummary.roundNumbers.includes(requestedRound) ? requestedRound : (tournamentSummary.roundNumbers[0] ?? 1);
  const overview = await loadOrNotFound(() => getConsoleOverview(tournamentId, roundNumber));
  return (
    <PageShell signedInUser={signedInUser} isWide>
      <TournamentNavigation signedInUser={signedInUser} tournamentId={tournamentId} tournamentName={tournamentSummary.name} roundNumbers={tournamentSummary.roundNumbers} logoStorageKey={tournamentSummary.logoStorageKey} />
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{vi.console.pageTitle}</h2>
        <LiveRefresh tournamentId={tournamentId} timezone={tournamentSummary.timezone} />
      </div>
      <TechnicalConsole tournamentId={tournamentId} timezone={tournamentSummary.timezone} roundNumbers={tournamentSummary.roundNumbers} overview={overview} />
    </PageShell>
  );
}
