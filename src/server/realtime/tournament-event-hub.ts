// src/server/realtime/tournament-event-hub.ts
// In-process fan-out of change notifications to SSE subscribers, keyed by tournament.
// The PostgreSQL listener publishes here; each open SSE stream subscribes for one tournament.
// Kept on globalThis so Next.js hot reload in development does not create a second hub.

/** Channels the app NOTIFYs on. */
export type TournamentEventType = "result_changed" | "tournament_changed";

/** One change, as delivered to SSE clients. */
export interface TournamentEvent {
  type: TournamentEventType;
  tournamentId: string;
  /** Present for result changes and round-scoped pairing changes. */
  roundNumber?: number;
  gameId?: string;
  status?: string;
  version?: number;
}

/** Callback invoked for each event of the subscribed tournament. */
export type TournamentEventHandler = (tournamentEvent: TournamentEvent) => void;

interface TournamentEventHubState {
  handlersByTournamentId: Map<string, Set<TournamentEventHandler>>;
}

const globalForHub = globalThis as unknown as { tournamentEventHubState?: TournamentEventHubState };
const hubState: TournamentEventHubState = (globalForHub.tournamentEventHubState ??= { handlersByTournamentId: new Map() });

/**
 * Subscribes to one tournament's events.
 *
 * @param tournamentId - Tournament to follow.
 * @param handler - Called for each event.
 * @returns A function that removes the subscription.
 */
export function subscribeToTournamentEvents(tournamentId: string, handler: TournamentEventHandler): () => void {
  const handlers = hubState.handlersByTournamentId.get(tournamentId) ?? new Set<TournamentEventHandler>();
  handlers.add(handler);
  hubState.handlersByTournamentId.set(tournamentId, handlers);
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) {
      hubState.handlersByTournamentId.delete(tournamentId);
    }
  };
}

/**
 * Delivers an event to every subscriber of its tournament. A failing handler (e.g. a closed stream) must not
 * prevent delivery to the others.
 *
 * @param tournamentEvent - Event to deliver.
 */
export function publishTournamentEvent(tournamentEvent: TournamentEvent): void {
  const handlers = hubState.handlersByTournamentId.get(tournamentEvent.tournamentId);
  for (const handler of handlers ?? []) {
    try {
      handler(tournamentEvent);
    } catch (error) {
      console.error("Tournament event handler failed", error);
    }
  }
}

/**
 * Number of open subscriptions, for diagnostics and tests.
 *
 * @returns Subscriber count across tournaments.
 */
export function countTournamentEventSubscribers(): number {
  let subscriberCount = 0;
  for (const handlers of hubState.handlersByTournamentId.values()) {
    subscriberCount += handlers.size;
  }
  return subscriberCount;
}
