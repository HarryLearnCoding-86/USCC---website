// src/components/live-refresh.tsx
// Keeps a server-rendered page current: listens to the tournament's SSE stream and re-renders the page data with
// router.refresh() on every change and every reconnect (SRS-LOOK-05, SRS-TD-01, SRS-SYNC-05). Shows a small
// connection indicator so arbiters know whether what they see is live.

"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import { vi } from "@/i18n/vi";
import { useTournamentEventStream } from "@/client/realtime/use-tournament-event-stream";
import { formatTimeOfDayInTimezone } from "@/server/domain/date-time-format";

/** Minimum gap between refreshes, so a burst of confirmations causes one re-render instead of dozens. */
const REFRESH_THROTTLE_MILLISECONDS = 500;

/**
 * Live refresh indicator.
 *
 * @param props.tournamentId - Tournament to follow.
 * @param props.timezone - Tournament timezone for the "updated at" time.
 * @param props.roundNumber - When set, changes to other rounds are ignored (tournament-wide changes still refresh).
 * @returns A one-line status.
 */
export function LiveRefresh({ tournamentId, timezone, roundNumber }: { tournamentId: string; timezone: string; roundNumber?: number }) {
  const router = useRouter();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { connectionState, lastSyncAt } = useTournamentEventStream(tournamentId, (liveChangeEvent) => {
    const isOtherRound = roundNumber !== undefined && liveChangeEvent.roundNumber !== undefined && liveChangeEvent.roundNumber !== roundNumber;
    if (isOtherRound && liveChangeEvent.reason === "tournament_changed") return;
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      router.refresh();
    }, REFRESH_THROTTLE_MILLISECONDS);
  });

  const statusText =
    connectionState === "CONNECTED" && lastSyncAt
      ? vi.liveStatus.connected(formatTimeOfDayInTimezone(lastSyncAt, timezone))
      : connectionState === "DISCONNECTED"
        ? vi.liveStatus.disconnected
        : vi.liveStatus.connecting;
  return (
    <p
      data-testid="live-status"
      role={connectionState === "DISCONNECTED" ? "alert" : "status"}
      className={`text-xs ${connectionState === "DISCONNECTED" ? "text-red-700" : "text-gray-500"}`}
    >
      {statusText}
    </p>
  );
}
