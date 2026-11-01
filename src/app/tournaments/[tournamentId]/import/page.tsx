// src/app/tournaments/[tournamentId]/import/page.tsx
// /tournaments/[id]/import — TD import wizard for a round's pairings from Excel (SRS-IMP-01..11).

import { vi } from "@/i18n/vi";
import { requirePageUser } from "@/server/auth/page-guards";
import { loadOrNotFound } from "@/server/http/page-data-loaders";
import { getTournamentSummary } from "@/server/services/game-query-service";
import { PageShell } from "@/components/page-shell";
import { PairingImportWizard } from "@/components/pairing-import-wizard";
import { TournamentNavigation } from "@/components/tournament-navigation";

/**
 * Import page.
 *
 * @param props.params - Route params with tournamentId.
 * @returns The wizard; TECHNICAL only.
 */
export default async function ImportPage({ params }: { params: Promise<{ tournamentId: string }> }) {
  const signedInUser = await requirePageUser("IMPORT_PAIRINGS");
  const { tournamentId } = await params;
  const tournamentSummary = await loadOrNotFound(() => getTournamentSummary(tournamentId));
  return (
    <PageShell signedInUser={signedInUser} isWide>
      <TournamentNavigation signedInUser={signedInUser} tournamentId={tournamentId} tournamentName={tournamentSummary.name} roundNumbers={tournamentSummary.roundNumbers} logoStorageKey={tournamentSummary.logoStorageKey} />
      <h2 className="mb-3 text-lg font-semibold">{vi.importExport.importTitle}</h2>
      <PairingImportWizard tournamentId={tournamentId} roundNumbers={tournamentSummary.roundNumbers} />
    </PageShell>
  );
}
