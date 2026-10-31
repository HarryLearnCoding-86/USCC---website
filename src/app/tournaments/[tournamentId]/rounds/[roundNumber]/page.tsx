// src/app/tournaments/[tournamentId]/rounds/[roundNumber]/page.tsx
// /tournaments/[id]/rounds/[n] — pairing list for TD and recorders with search, filter and status (SRS-LOOK-01..04).

import { vi } from "@/i18n/vi";
import { requirePageUser } from "@/server/auth/page-guards";
import { loadOrNotFound, parsePositiveIntegerSegment } from "@/server/http/page-data-loaders";
import { getTournamentSummary, listRoundGames } from "@/server/services/game-query-service";
import { PageShell } from "@/components/page-shell";
import { RoundGameList } from "@/components/round-game-list";
import { TournamentNavigation } from "@/components/tournament-navigation";

/**
 * Round page.
 *
 * @param props.params - Route params with tournamentId and roundNumber.
 * @returns The round's games; both roles.
 */
export default async function RoundPage({ params }: { params: Promise<{ tournamentId: string; roundNumber: string }> }) {
  const signedInUser = await requirePageUser("LOOK_UP_GAMES");
  const routeParams = await params;
  const roundNumber = parsePositiveIntegerSegment(routeParams.roundNumber);
  const [tournamentSummary, games] = await loadOrNotFound(() =>
    Promise.all([getTournamentSummary(routeParams.tournamentId), listRoundGames(routeParams.tournamentId, roundNumber)]),
  );
  return (
    <PageShell signedInUser={signedInUser}>
      <TournamentNavigation signedInUser={signedInUser} tournamentId={tournamentSummary.id} tournamentName={tournamentSummary.name} roundNumbers={tournamentSummary.roundNumbers} />
      <h2 className="mb-3 text-lg font-semibold">{vi.rounds.roundTitle(roundNumber)}</h2>
      <RoundGameList games={games} />
    </PageShell>
  );
}
