// src/app/record/[gameId]/page.tsx
// /record/[gameId] — mobile result entry and the two-player confirmation flow (SRS-RES-01..06, SRS-CONF-01..10).
// RECORDER and TECHNICAL. The page always loads the current server state, so reopening it resumes the flow.

import { vi } from "@/i18n/vi";
import { requirePageUser } from "@/server/auth/page-guards";
import { loadOrNotFound } from "@/server/http/page-data-loaders";
import { getGameView, getTournamentSummary, listResultCodes } from "@/server/services/game-query-service";
import { PageShell } from "@/components/page-shell";
import { ResultRecordingFlow } from "@/components/result-recording-flow";

/**
 * Record page.
 *
 * @param props.params - Route params with gameId.
 * @returns The recording flow for the game.
 */
export default async function RecordGamePage({ params }: { params: Promise<{ gameId: string }> }) {
  const signedInUser = await requirePageUser("SUBMIT_RESULTS");
  const { gameId } = await params;
  const game = await loadOrNotFound(() => getGameView(gameId));
  const [tournamentSummary, resultCodes] = await Promise.all([getTournamentSummary(game.tournamentId), listResultCodes(game.tournamentId)]);
  return (
    <PageShell signedInUser={signedInUser}>
      <div className="mx-auto max-w-md">
        <p className="mb-2 text-sm text-gray-600">{tournamentSummary.name} · {vi.record.pageTitle}</p>
        <ResultRecordingFlow
          initialGame={game}
          resultCodes={resultCodes.filter((resultCode) => resultCode.isActive)}
          viewerRole={signedInUser.role}
          viewerUsername={signedInUser.username}
          roundListHref={`/tournaments/${game.tournamentId}/rounds/${game.roundNumber}`}
        />
      </div>
    </PageShell>
  );
}
