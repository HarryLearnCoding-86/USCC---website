// src/app/tournaments/[tournamentId]/rounds/[roundNumber]/manual/page.tsx
// /tournaments/[id]/rounds/[n]/manual — TD manual pairing entry for a round (SRS-IMP-13).

import { vi } from "@/i18n/vi";
import { requirePageUser } from "@/server/auth/page-guards";
import { loadOrNotFound, parsePositiveIntegerSegment } from "@/server/http/page-data-loaders";
import { getTournamentSummary, listRoundGames } from "@/server/services/game-query-service";
import { ManualPairingEditor } from "@/components/manual-pairing-editor";
import { PageShell } from "@/components/page-shell";
import { TournamentNavigation } from "@/components/tournament-navigation";

/**
 * Manual pairing entry page.
 *
 * @param props.params - Route params with tournamentId and roundNumber.
 * @returns The editor; TECHNICAL only.
 */
export default async function ManualPairingPage({ params }: { params: Promise<{ tournamentId: string; roundNumber: string }> }) {
  const signedInUser = await requirePageUser("MANAGE_TOURNAMENTS");
  const routeParams = await params;
  const roundNumber = parsePositiveIntegerSegment(routeParams.roundNumber);
  const [tournamentSummary, games] = await loadOrNotFound(() =>
    Promise.all([getTournamentSummary(routeParams.tournamentId), listRoundGames(routeParams.tournamentId, roundNumber)]),
  );
  return (
    <PageShell signedInUser={signedInUser} isWide>
      <TournamentNavigation signedInUser={signedInUser} tournamentId={tournamentSummary.id} tournamentName={tournamentSummary.name} roundNumbers={tournamentSummary.roundNumbers} />
      <h2 className="mb-3 text-lg font-semibold">{vi.manualPairing.pageTitle(roundNumber)}</h2>
      <ManualPairingEditor tournamentId={tournamentSummary.id} roundNumber={roundNumber} games={games} />
    </PageShell>
  );
}
