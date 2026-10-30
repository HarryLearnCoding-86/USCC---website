// src/app/tournaments/[tournamentId]/projection/page.tsx
// /tournaments/[id]/projection?round=n&pageSeconds=s — full-screen projection for the TD's projector
// (SRS-PROJ-01..08). TECHNICAL only; there is no public URL. No app header, to give the projector the full screen.

import { requirePageUser } from "@/server/auth/page-guards";
import { clampPageIntervalSeconds } from "@/server/domain/projection-paging";
import { loadOrNotFound } from "@/server/http/page-data-loaders";
import { getProjectionView } from "@/server/services/projection-service";
import { ProjectionScreen } from "@/components/projection-screen";

/**
 * Projection page.
 *
 * @param props.params - Route params with tournamentId.
 * @param props.searchParams - Optional round and pageSeconds (5–30, default 10).
 * @returns The projection screen.
 */
export default async function ProjectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ tournamentId: string }>;
  searchParams: Promise<{ round?: string; pageSeconds?: string }>;
}) {
  await requirePageUser("VIEW_PROJECTION");
  const { tournamentId } = await params;
  const { round, pageSeconds } = await searchParams;
  const requestedRound = Number(round);
  const projection = await loadOrNotFound(() =>
    getProjectionView(tournamentId, Number.isInteger(requestedRound) && requestedRound > 0 ? requestedRound : null),
  );
  return <ProjectionScreen key={projection.roundNumber} initialProjection={projection} pageIntervalSeconds={clampPageIntervalSeconds(pageSeconds)} />;
}
