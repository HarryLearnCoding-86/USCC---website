// src/server/services/change-notifier.ts
// Sends PostgreSQL NOTIFY messages that feed live screens (AGENT_PROMPT.md §3.6, SRS-TOUR-04, SRS-LOOK-05).
// Called inside the use case's transaction: PostgreSQL delivers a NOTIFY only when the transaction commits,
// so screens never see a change that was rolled back.

import type { DatabaseClient } from "@/server/database/database-client";

/** Payload of result_changed. */
export interface ResultChangedPayload {
  tournamentId: string;
  roundNumber: number;
  gameId: string;
  status: string;
  version: number;
}

/** Payload of tournament_changed (settings, logo, result codes or pairings). */
export interface TournamentChangedPayload {
  tournamentId: string;
  /** Set when only one round's pairings changed. */
  roundNumber?: number;
}

/**
 * Notifies listeners that a result changed.
 *
 * @param payload - Identifies the game and its new status/version.
 * @param database - Transaction client of the use case.
 */
export async function notifyResultChanged(payload: ResultChangedPayload, database: DatabaseClient): Promise<void> {
  await database.$executeRaw`SELECT pg_notify('result_changed', ${JSON.stringify(payload)})`;
}

/**
 * Notifies listeners that tournament data other than a result changed.
 *
 * @param payload - Tournament (and optionally round) affected.
 * @param database - Transaction client of the use case.
 */
export async function notifyTournamentChanged(payload: TournamentChangedPayload, database: DatabaseClient): Promise<void> {
  await database.$executeRaw`SELECT pg_notify('tournament_changed', ${JSON.stringify(payload)})`;
}
