// src/components/projection-screen.tsx
// Full-screen read-only results display for the projector (SRS-PROJ-01..08, NFR-01): tournament branding, round,
// board / White / Black / official result, provisional points, "Cập nhật lúc HH:mm:ss", an offline banner that
// keeps the last data on screen, and automatic paging when the round does not fit one screen.
// Data is refetched from the server after every live event, so filtering stays server-side.

"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { vi } from "@/i18n/vi";
import { useTournamentEventStream } from "@/client/realtime/use-tournament-event-stream";
import { formatTimeOfDayInTimezone } from "@/server/domain/date-time-format";
import { computePageCount, computeRowsPerPage, selectPageItems } from "@/server/domain/projection-paging";
import type { ProjectionGame, ProjectionView } from "@/server/services/projection-service";

/** Height of one table row in pixels; with 32–40 px text this keeps names readable from 8 m (SRS-PROJ-07). */
const ROW_HEIGHT_PIXELS = 84;
/** Space taken by the header, column titles and footer. */
const CHROME_HEIGHT_PIXELS = 260;

/**
 * Projection screen.
 *
 * @param props.initialProjection - Server-rendered data.
 * @param props.pageIntervalSeconds - Seconds per page (5–30, SRS-PROJ-06).
 * @returns The full-screen display.
 */
export function ProjectionScreen({ initialProjection, pageIntervalSeconds }: { initialProjection: ProjectionView; pageIntervalSeconds: number }) {
  const [projection, setProjection] = useState(initialProjection);
  const [lastSuccessfulFetchAt, setLastSuccessfulFetchAt] = useState(() => new Date(initialProjection.generatedAt));
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);
  const isFetchingRef = useRef(false);
  const hasPendingFetchRef = useRef(false);

  const reloadProjection = useCallback(async () => {
    // Coalesce bursts of events (e.g. a whole round confirmed at once) into back-to-back fetches.
    if (isFetchingRef.current) {
      hasPendingFetchRef.current = true;
      return;
    }
    isFetchingRef.current = true;
    try {
      do {
        hasPendingFetchRef.current = false;
        const response = await fetch(`/api/tournaments/${projection.tournamentId}/projection?round=${projection.roundNumber}`, { cache: "no-store" });
        if (response.ok) {
          setProjection(((await response.json()) as { projection: ProjectionView }).projection);
          setLastSuccessfulFetchAt(new Date());
        }
      } while (hasPendingFetchRef.current);
    } catch {
      // Keep the last data on screen (SRS-PROJ-05); the offline banner shows the connection state.
    } finally {
      isFetchingRef.current = false;
    }
  }, [projection.tournamentId, projection.roundNumber]);

  const { connectionState, lastSyncAt } = useTournamentEventStream(projection.tournamentId, () => void reloadProjection());

  useEffect(() => {
    const updateRowsPerPage = () => setRowsPerPage(computeRowsPerPage(window.innerHeight - CHROME_HEIGHT_PIXELS, ROW_HEIGHT_PIXELS));
    updateRowsPerPage();
    window.addEventListener("resize", updateRowsPerPage);
    return () => window.removeEventListener("resize", updateRowsPerPage);
  }, []);

  const pageCount = computePageCount(projection.games.length, rowsPerPage);
  useEffect(() => {
    if (pageCount <= 1) return undefined;
    const pageTimer = setInterval(() => setPageIndex((currentPage) => (currentPage + 1) % pageCount), pageIntervalSeconds * 1000);
    return () => clearInterval(pageTimer);
  }, [pageCount, pageIntervalSeconds]);

  const visibleGames = selectPageItems(projection.games, pageIndex, rowsPerPage);
  const displayedSyncAt = lastSyncAt && lastSyncAt > lastSuccessfulFetchAt ? lastSyncAt : lastSuccessfulFetchAt;
  const brandStyle = {
    "--brand-primary": projection.primaryColor ?? "#1d4ed8",
    "--brand-secondary": projection.secondaryColor ?? "#1e3a8a",
  } as CSSProperties;

  return (
    <div style={brandStyle} className="flex min-h-screen flex-col bg-white text-gray-900" data-testid="projection-screen" data-connection-state={connectionState}>
      <header className="flex items-center gap-6 bg-brand-primary px-8 py-4 text-white">
        {projection.logoUrl && (
          // A plain <img>: the logo is served by an authenticated route and must not go through image optimisation.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={projection.logoUrl} alt={vi.projection.logoAlt} className="h-20 w-auto rounded bg-white p-1" />
        )}
        <div className="flex-1">
          <h1 className="text-4xl font-bold leading-tight">{projection.tournamentName}</h1>
          <p className="text-3xl font-semibold">{vi.projection.roundTitle(projection.roundNumber)}</p>
        </div>
        <div className="text-right text-xl">
          <p data-testid="projection-last-sync">{vi.projection.lastSync(formatTimeOfDayInTimezone(displayedSyncAt, projection.timezone))}</p>
          {pageCount > 1 && <p>{vi.projection.pageIndicator((pageIndex % pageCount) + 1, pageCount)}</p>}
        </div>
      </header>
      {connectionState === "DISCONNECTED" && (
        <div role="alert" className="bg-red-700 px-8 py-3 text-2xl font-semibold text-white" data-testid="projection-offline-banner">
          {vi.projection.offlineBanner}
        </div>
      )}
      <main className="flex-1 px-8 py-4">
        {projection.games.length === 0 ? (
          <p className="text-3xl text-gray-600">{vi.projection.noGames}</p>
        ) : (
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="border-b-4 border-brand-secondary text-left text-2xl text-gray-600">
                <th className="w-28 py-2">{vi.projection.board}</th>
                <th className="py-2">{vi.projection.white}</th>
                <th className="w-64 py-2 text-center">{vi.projection.result}</th>
                <th className="py-2">{vi.projection.black}</th>
              </tr>
            </thead>
            <tbody>{visibleGames.map((game) => <ProjectionRow key={game.boardNumber} game={game} />)}</tbody>
          </table>
        )}
      </main>
      {projection.hasProvisionalPoints && <footer className="px-8 pb-4 text-xl text-gray-600">{vi.projection.provisionalPointsNote}</footer>}
    </div>
  );
}

/**
 * One board row. Names ≥ 28 px and results ≥ 32 px (SRS-PROJ-07); byes show "Miễn đấu" with no opponent and no
 * result styling that could suggest a played game (SRS-PROJ-08).
 *
 * @param props.game - The board.
 * @returns A table row.
 */
function ProjectionRow({ game }: { game: ProjectionGame }) {
  const nameWithPoints = (playerName: string, pointsText: string | null) => (pointsText === null ? playerName : `${playerName} (${pointsText})`);
  return (
    <tr className="border-b border-gray-200" style={{ height: ROW_HEIGHT_PIXELS }} data-testid={`projection-row-${game.boardNumber}`}>
      <td className="text-[32px] font-bold">{game.boardNumber}</td>
      <td className="truncate pr-4 text-[32px] font-semibold">{nameWithPoints(game.whiteName, game.whitePointsText)}</td>
      <td className="text-center" data-testid={`projection-result-${game.boardNumber}`}>
        {game.officialResult && (
          <>
            <span className="block text-[40px] font-bold leading-none">{game.officialResult.scoreLine}</span>
            {game.officialResult.isWithoutPlayerConfirmation && <span className="block text-lg text-gray-600">{game.officialResult.labelVi}</span>}
          </>
        )}
      </td>
      <td className="truncate text-[32px] font-semibold">
        {game.blackName === null ? <span className="italic text-gray-600">{vi.projection.bye}</span> : nameWithPoints(game.blackName, game.blackPointsText)}
      </td>
    </tr>
  );
}
