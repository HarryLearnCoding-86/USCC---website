// src/app/tournaments/[tournamentId]/settings/page.tsx
// /tournaments/[id]/settings — TD edits details and colours (SRS-TOUR-01..04), manages result codes
// (SRS-TOUR-05..07) and opens manual pairing entry per round (SRS-IMP-13).

import Link from "next/link";
import { vi } from "@/i18n/vi";
import { requirePageUser } from "@/server/auth/page-guards";
import { loadOrNotFound } from "@/server/http/page-data-loaders";
import { getTournamentSummary, listResultCodes } from "@/server/services/game-query-service";
import { getTournamentSettings } from "@/server/services/tournament-service";
import { LogoUploader } from "@/components/logo-uploader";
import { PageShell } from "@/components/page-shell";
import { ResultCodeManager } from "@/components/result-code-manager";
import { TournamentForm } from "@/components/tournament-form";
import { TournamentNavigation } from "@/components/tournament-navigation";

/**
 * Tournament settings page.
 *
 * @param props.params - Route params with tournamentId.
 * @returns Details form, manual-entry links and the result-code manager; TECHNICAL only.
 */
export default async function TournamentSettingsPage({ params }: { params: Promise<{ tournamentId: string }> }) {
  const signedInUser = await requirePageUser("MANAGE_TOURNAMENTS");
  const { tournamentId } = await params;
  const [tournamentSettings, tournamentSummary] = await loadOrNotFound(() =>
    Promise.all([getTournamentSettings(tournamentId), getTournamentSummary(tournamentId)]),
  );
  const resultCodes = await listResultCodes(tournamentId);

  return (
    <PageShell signedInUser={signedInUser} isWide>
      <TournamentNavigation signedInUser={signedInUser} tournamentId={tournamentId} tournamentName={tournamentSummary.name} roundNumbers={tournamentSummary.roundNumbers} logoStorageKey={tournamentSummary.logoStorageKey} />
      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">{vi.tournaments.detailsHeading}</h2>
        <TournamentForm
          tournamentId={tournamentId}
          initialValues={{
            ...tournamentSettings,
            venue: tournamentSettings.venue ?? "",
            organizer: tournamentSettings.organizer ?? "",
            primaryColor: tournamentSettings.primaryColor ?? "#1d4ed8",
            secondaryColor: tournamentSettings.secondaryColor ?? "#1e3a8a",
          }}
        />
      </section>
      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">{vi.logo.heading}</h2>
        <LogoUploader
          tournamentId={tournamentId}
          logoUrl={tournamentSummary.logoStorageKey ? `/api/tournaments/${tournamentId}/logo?v=${encodeURIComponent(tournamentSummary.logoStorageKey)}` : null}
        />
      </section>
      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">{vi.tournaments.manualEntryLink}</h2>
        <div className="flex flex-wrap gap-2">
          {tournamentSummary.roundNumbers.map((roundNumber) => (
            <Link key={roundNumber} href={`/tournaments/${tournamentId}/rounds/${roundNumber}/manual`} className="btn-secondary min-h-[44px] inline-flex items-center">
              {vi.rounds.roundTitle(roundNumber)}
            </Link>
          ))}
        </div>
      </section>
      <ResultCodeManager tournamentId={tournamentId} resultCodes={resultCodes} />
    </PageShell>
  );
}
