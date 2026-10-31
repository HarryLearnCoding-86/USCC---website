// src/server/realtime/postgres-change-listener.ts
// One long-lived PostgreSQL connection that LISTENs on result_changed and tournament_changed and publishes each
// NOTIFY to the in-process event hub (AGENT_PROMPT.md §3.6). Prisma cannot LISTEN, hence the `pg` driver.
// Started lazily by the first SSE subscriber; reconnects with exponential backoff (1 s → 30 s) if the
// connection drops, so live screens recover after a database restart.

import { Client } from "pg";
import { computeRetryDelayMilliseconds } from "@/server/domain/retry-backoff";
import { getServerEnvironment } from "@/server/config/server-environment";
import { publishTournamentEvent, type TournamentEvent, type TournamentEventType } from "@/server/realtime/tournament-event-hub";

/** Channels listened on; must match the pg_notify calls in the services. */
export const LISTENED_CHANNELS: readonly TournamentEventType[] = ["result_changed", "tournament_changed"];

interface ListenerState {
  connectingPromise: Promise<void> | null;
  activeClient: Client | null;
  failedAttemptCount: number;
}

const globalForListener = globalThis as unknown as { postgresChangeListenerState?: ListenerState };
const listenerState: ListenerState = (globalForListener.postgresChangeListenerState ??= {
  connectingPromise: null,
  activeClient: null,
  failedAttemptCount: 0,
});

/**
 * Builds the pg connection string from DATABASE_URL. Prisma's `?schema=` parameter means nothing to pg,
 * so the query string is dropped.
 *
 * @returns Connection string for pg.
 */
function buildListenerConnectionString(): string {
  return getServerEnvironment().DATABASE_URL.replace(/\?.*$/, "");
}

/**
 * Parses a NOTIFY payload into a hub event; malformed payloads are ignored rather than crashing the listener.
 *
 * @param channel - Channel name.
 * @param payload - JSON text sent with pg_notify.
 * @returns The event, or null when the payload is unusable.
 */
export function parseNotificationPayload(channel: string, payload: string | undefined): TournamentEvent | null {
  if (!LISTENED_CHANNELS.includes(channel as TournamentEventType) || !payload) {
    return null;
  }
  try {
    const parsedPayload = JSON.parse(payload) as Omit<TournamentEvent, "type">;
    return typeof parsedPayload.tournamentId === "string" ? { ...parsedPayload, type: channel as TournamentEventType } : null;
  } catch {
    return null;
  }
}

/**
 * Ensures the listener connection is up. Safe to call on every SSE connect: concurrent callers share one attempt.
 *
 * @returns Resolves once LISTEN is active.
 * @throws The connection error when PostgreSQL is unreachable (a reconnect is already scheduled).
 */
export function ensurePostgresChangeListener(): Promise<void> {
  if (listenerState.activeClient) {
    return Promise.resolve();
  }
  listenerState.connectingPromise ??= connectListener().finally(() => {
    listenerState.connectingPromise = null;
  });
  return listenerState.connectingPromise;
}

/**
 * Opens the connection, issues LISTEN for every channel and wires reconnect-on-error.
 */
async function connectListener(): Promise<void> {
  const listenerClient = new Client({ connectionString: buildListenerConnectionString() });
  listenerClient.on("notification", (notification) => {
    const tournamentEvent = parseNotificationPayload(notification.channel, notification.payload);
    if (tournamentEvent) {
      publishTournamentEvent(tournamentEvent);
    }
  });
  listenerClient.on("error", (error) => handleListenerFailure(listenerClient, error));
  listenerClient.on("end", () => handleListenerFailure(listenerClient, new Error("listener connection ended")));
  try {
    await listenerClient.connect();
    for (const channel of LISTENED_CHANNELS) {
      // Channel names are constants from LISTENED_CHANNELS, never user input.
      await listenerClient.query(`LISTEN ${channel}`);
    }
    listenerState.activeClient = listenerClient;
    listenerState.failedAttemptCount = 0;
  } catch (error) {
    handleListenerFailure(listenerClient, error);
    throw error;
  }
}

/**
 * Drops a broken connection and schedules a reconnect with backoff.
 *
 * @param failedClient - The client that failed.
 * @param error - What went wrong (logged).
 */
function handleListenerFailure(failedClient: Client, error: unknown): void {
  if (listenerState.activeClient && listenerState.activeClient !== failedClient) {
    return;
  }
  listenerState.activeClient = null;
  failedClient.removeAllListeners();
  failedClient.end().catch(() => undefined);
  const retryDelay = computeRetryDelayMilliseconds(listenerState.failedAttemptCount);
  listenerState.failedAttemptCount += 1;
  console.error(`PostgreSQL change listener failed; reconnecting in ${retryDelay} ms`, error);
  setTimeout(() => {
    ensurePostgresChangeListener().catch(() => undefined);
  }, retryDelay);
}

/**
 * Closes the listener (used by tests to release the connection).
 */
export async function stopPostgresChangeListener(): Promise<void> {
  const activeClient = listenerState.activeClient;
  listenerState.activeClient = null;
  if (activeClient) {
    activeClient.removeAllListeners();
    await activeClient.end();
  }
}
