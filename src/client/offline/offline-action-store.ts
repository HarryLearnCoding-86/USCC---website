// src/client/offline/offline-action-store.ts
// Persistent queue of recorder actions that could not reach the server (AGENT_PROMPT.md §3.6, SRS-SYNC-01).
// The IndexedDB implementation (via idb) survives page reloads and browser restarts (NFR-05); the interface lets
// the sync engine be unit-tested with an in-memory store.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/** One queued mutation, replayed later with the same Idempotency-Key so it applies exactly once (SRS-SYNC-03). */
export interface QueuedAction {
  idempotencyKey: string;
  /** Monotonic order; actions replay strictly in this order (a confirmation must follow its submit). */
  sequence: number;
  httpMethod: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  requestBody: unknown;
  /** Vietnamese description shown in the badge and in rejection notices. */
  description: string;
  /** Only the arbiter who queued an action replays it, so the audit log names the right recorder. */
  ownerUserId: string;
  createdAt: string;
}

/** Storage operations the sync engine needs. */
export interface OfflineActionStore {
  /** Adds an action at the end of the queue. */
  appendAction(queuedAction: QueuedAction): Promise<void>;
  /** All actions ordered by sequence. */
  listActionsInOrder(): Promise<QueuedAction[]>;
  /** Removes an action after it was applied or rejected. */
  removeAction(idempotencyKey: string): Promise<void>;
}

interface OfflineQueueDatabaseSchema extends DBSchema {
  "queued-actions": {
    key: string;
    value: QueuedAction;
    indexes: { "by-sequence": number };
  };
}

const DATABASE_NAME = "uscc-offline-queue";
const DATABASE_VERSION = 1;
const STORE_NAME = "queued-actions";

/** IndexedDB-backed queue. */
export class IndexedDbOfflineActionStore implements OfflineActionStore {
  private databasePromise: Promise<IDBPDatabase<OfflineQueueDatabaseSchema>> | null = null;

  /**
   * Opens (and on first use creates) the database.
   *
   * @returns The open database.
   * @throws When IndexedDB is unavailable (e.g. some private-browsing modes).
   */
  private openDatabase(): Promise<IDBPDatabase<OfflineQueueDatabaseSchema>> {
    this.databasePromise ??= openDB<OfflineQueueDatabaseSchema>(DATABASE_NAME, DATABASE_VERSION, {
      upgrade(database) {
        const objectStore = database.createObjectStore(STORE_NAME, { keyPath: "idempotencyKey" });
        objectStore.createIndex("by-sequence", "sequence");
      },
    });
    return this.databasePromise;
  }

  async appendAction(queuedAction: QueuedAction): Promise<void> {
    await (await this.openDatabase()).put(STORE_NAME, queuedAction);
  }

  async listActionsInOrder(): Promise<QueuedAction[]> {
    return (await this.openDatabase()).getAllFromIndex(STORE_NAME, "by-sequence");
  }

  async removeAction(idempotencyKey: string): Promise<void> {
    await (await this.openDatabase()).delete(STORE_NAME, idempotencyKey);
  }
}
