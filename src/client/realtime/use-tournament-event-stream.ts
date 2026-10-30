// src/client/realtime/use-tournament-event-stream.ts
// React hook that keeps an SSE connection to /api/tournaments/:id/events (AGENT_PROMPT.md §3.6).
// On error it closes the EventSource and reconnects itself with exponential backoff (1 s → 30 s) instead of the
// browser's fixed retry. Every successful (re)connect fires onChange so the screen reloads full state and nothing
// missed while offline stays stale (SRS-SYNC-05). Heartbeats prove the stream is alive and update lastSyncAt.

"use client";

import { useEffect, useRef, useState } from "react";
import { computeRetryDelayMilliseconds } from "@/server/domain/retry-backoff";

/** Connection state shown to the arbiter. */
export type LiveConnectionState = "CONNECTING" | "CONNECTED" | "DISCONNECTED";

/** What triggered a reload. */
export type LiveChangeReason = "connected" | "result_changed" | "tournament_changed";

/** A change notification as received from the server. */
export interface LiveChangeEvent {
  reason: LiveChangeReason;
  roundNumber?: number;
  gameId?: string;
}

/** Hook result. */
export interface TournamentEventStreamState {
  connectionState: LiveConnectionState;
  /** Last time the server was heard from (ready, change or heartbeat). */
  lastSyncAt: Date | null;
}

/**
 * Subscribes to a tournament's live changes.
 *
 * @param tournamentId - Tournament to follow.
 * @param onChange - Called on connect/reconnect and for each change; should reload the screen's data.
 * @returns Connection state and last sync time.
 */
export function useTournamentEventStream(tournamentId: string, onChange: (liveChangeEvent: LiveChangeEvent) => void): TournamentEventStreamState {
  const [connectionState, setConnectionState] = useState<LiveConnectionState>("CONNECTING");
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let failedAttemptCount = 0;
    let isUnmounted = false;

    const handleChange = (reason: LiveChangeReason) => (messageEvent: MessageEvent<string>) => {
      setLastSyncAt(new Date());
      let parsedData: { roundNumber?: number; gameId?: string } = {};
      try {
        parsedData = JSON.parse(messageEvent.data) as typeof parsedData;
      } catch {
        // A malformed message still triggers a full reload below.
      }
      onChangeRef.current({ reason, ...parsedData });
    };

    const connect = () => {
      if (isUnmounted) return;
      setConnectionState("CONNECTING");
      eventSource = new EventSource(`/api/tournaments/${tournamentId}/events`);
      eventSource.addEventListener("ready", () => {
        failedAttemptCount = 0;
        setConnectionState("CONNECTED");
        setLastSyncAt(new Date());
        onChangeRef.current({ reason: "connected" });
      });
      eventSource.addEventListener("heartbeat", () => setLastSyncAt(new Date()));
      eventSource.addEventListener("result_changed", handleChange("result_changed"));
      eventSource.addEventListener("tournament_changed", handleChange("tournament_changed"));
      eventSource.onerror = () => {
        eventSource?.close();
        eventSource = null;
        if (isUnmounted) return;
        setConnectionState("DISCONNECTED");
        const retryDelay = computeRetryDelayMilliseconds(failedAttemptCount);
        failedAttemptCount += 1;
        reconnectTimer = setTimeout(connect, retryDelay);
      };
    };

    connect();
    return () => {
      isUnmounted = true;
      eventSource?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [tournamentId]);

  return { connectionState, lastSyncAt };
}
