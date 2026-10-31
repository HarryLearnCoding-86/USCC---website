// src/server/realtime/server-sent-events.ts
// Builds the text/event-stream response for one tournament (AGENT_PROMPT.md §3.6): a "ready" event on connect,
// every result_changed / tournament_changed for that tournament, and a heartbeat every 15 s. Each heartbeat also
// re-checks the session, so a deactivated or logged-out arbiter's stream closes within one interval
// (SRS-AUTH-07: within 1 minute).

import { ensurePostgresChangeListener } from "@/server/realtime/postgres-change-listener";
import { subscribeToTournamentEvents, type TournamentEvent } from "@/server/realtime/tournament-event-hub";

/** AGENT_PROMPT.md §3.6: heartbeat every 15 s. */
export const HEARTBEAT_INTERVAL_MILLISECONDS = 15_000;

/** Tells EventSource how long to wait before its own automatic reconnect. */
const CLIENT_RETRY_MILLISECONDS = 1_000;

/**
 * Formats one SSE message.
 *
 * @param eventName - SSE event name.
 * @param eventData - JSON-serialisable data.
 * @returns The wire format "event: …\ndata: …\n\n".
 */
export function formatServerSentEvent(eventName: string, eventData: unknown): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(eventData)}\n\n`;
}

/** Inputs for opening a stream. */
export interface TournamentEventStreamOptions {
  tournamentId: string;
  /** Fires when the client disconnects. */
  abortSignal: AbortSignal;
  /** Returns false once the session is no longer valid; the stream then closes. */
  isSessionStillValid: () => Promise<boolean>;
  /** Injectable for tests. */
  heartbeatIntervalMilliseconds?: number;
}

/**
 * Opens an SSE stream of one tournament's changes.
 *
 * @param options - Tournament, abort signal, session check and heartbeat interval.
 * @returns A Response with an event stream body.
 */
export async function openTournamentEventStream(options: TournamentEventStreamOptions): Promise<Response> {
  // If PostgreSQL is briefly unreachable, still open the stream: the listener retries in the background, and
  // the client reloads full state on its next reconnect.
  await ensurePostgresChangeListener().catch(() => undefined);
  const textEncoder = new TextEncoder();
  let stopStream: () => void = () => undefined;

  const eventStream = new ReadableStream<Uint8Array>({
    start(streamController) {
      let isClosed = false;
      const send = (chunk: string) => {
        if (!isClosed) streamController.enqueue(textEncoder.encode(chunk));
      };
      const unsubscribe = subscribeToTournamentEvents(options.tournamentId, (tournamentEvent: TournamentEvent) =>
        send(formatServerSentEvent(tournamentEvent.type, tournamentEvent)),
      );
      const heartbeatTimer = setInterval(() => {
        void options.isSessionStillValid().then((isValid) => {
          if (!isValid) {
            stopStream();
            return;
          }
          send(formatServerSentEvent("heartbeat", { serverTime: new Date().toISOString() }));
        });
      }, options.heartbeatIntervalMilliseconds ?? HEARTBEAT_INTERVAL_MILLISECONDS);

      stopStream = () => {
        if (isClosed) return;
        isClosed = true;
        clearInterval(heartbeatTimer);
        unsubscribe();
        try {
          streamController.close();
        } catch {
          // Already closed by the runtime after a client disconnect.
        }
      };
      options.abortSignal.addEventListener("abort", stopStream);
      send(`retry: ${CLIENT_RETRY_MILLISECONDS}\n\n`);
      send(formatServerSentEvent("ready", { serverTime: new Date().toISOString() }));
    },
    cancel() {
      stopStream();
    },
  });

  return new Response(eventStream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tells nginx-style proxies not to buffer; Caddy streams by default.
      "X-Accel-Buffering": "no",
    },
  });
}
