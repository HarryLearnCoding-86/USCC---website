// src/app/tournaments/[tournamentId]/export/page.tsx
// /tournaments/[id]/export — TD downloads results for one round or the whole tournament (SRS-EXP-01..05):
// official results by default, or the separate reconciliation file; as Excel, or as XML for Swiss-Manager (OI-02). A plain GET form, so the browser handles the
// download with the session cookie and no client code is needed.

import { vi } from "@/i18n/vi";
import { requirePageUser } from "@/server/auth/page-guards";
import { loadOrNotFound } from "@/server/http/page-data-loaders";
import { getTournamentSummary } from "@/server/services/game-query-service";
import { PageShell } from "@/components/page-shell";
import { TournamentNavigation } from "@/components/tournament-navigation";

/**
 * Export page.
 *
 * @param props.params - Route params with tournamentId.
 * @returns The export form; TECHNICAL only.
 */
export default async function ExportPage({ params }: { params: Promise<{ tournamentId: string }> }) {
  const signedInUser = await requirePageUser("EXPORT_RESULTS");
  const { tournamentId } = await params;
  const tournamentSummary = await loadOrNotFound(() => getTournamentSummary(tournamentId));
  const controlClassName = "min-h-[44px] rounded-md border border-gray-300 px-3";
  return (
    <PageShell signedInUser={signedInUser}>
      <TournamentNavigation signedInUser={signedInUser} tournamentId={tournamentId} tournamentName={tournamentSummary.name} roundNumbers={tournamentSummary.roundNumbers} logoStorageKey={tournamentSummary.logoStorageKey} />
      <h2 className="mb-3 text-lg font-semibold">{vi.importExport.exportTitle}</h2>
      <form method="GET" action={`/api/tournaments/${tournamentId}/export`} className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4">
        <label className="flex flex-col gap-1 text-sm">
          {vi.importExport.exportScopeLabel}
          <select name="scope" defaultValue="all" className={controlClassName}>
            <option value="all">{vi.importExport.exportScopeAll}</option>
            {tournamentSummary.roundNumbers.map((roundNumber) => (
              <option key={roundNumber} value={`round:${roundNumber}`}>{vi.importExport.exportScopeRound(roundNumber)}</option>
            ))}
          </select>
        </label>
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1">{vi.importExport.exportIncludeLabel}</legend>
          <label className="flex items-center gap-2"><input type="radio" name="include" value="official" defaultChecked className="h-5 w-5" />{vi.importExport.exportIncludeOfficial}</label>
          <label className="flex items-center gap-2"><input type="radio" name="include" value="pending" className="h-5 w-5" />{vi.importExport.exportIncludeReconciliation}</label>
        </fieldset>
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1">{vi.importExport.exportFormatLabel}</legend>
          <label className="flex items-center gap-2"><input type="radio" name="format" value="xlsx" defaultChecked className="h-5 w-5" />{vi.importExport.exportFormatExcel}</label>
          <label className="flex items-center gap-2"><input type="radio" name="format" value="xml" className="h-5 w-5" />{vi.importExport.exportFormatXml}</label>
        </fieldset>
        <p className="text-xs text-gray-600">{vi.importExport.exportFormatNote}</p>
        <button type="submit" className="btn-primary min-h-[44px] self-start">{vi.importExport.exportDownloadButton}</button>
      </form>
    </PageShell>
  );
}
