// src/client/offline/offline-sync-runtime.ts
// Browser wiring for the offline queue: one OfflineSyncEngine per tab backed by IndexedDB and fetch, change events
// for the badge, and sendMutationWithOfflineFallback(), which recorder screens call instead of a bare fetch.
// If anything is already queued, new actions are queued behind it, so actions always reach the server in the order
// the recorder performed them.

import { generateIdempotencyKey, readCsrfToken } from "@/client/api-request";
import { IndexedDbOfflineActionStore, type QueuedAction } from "@/client/offline/offline-action-store";
import { OfflineSyncEngine, type RejectedAction, type SendOutcome } from "@/client/offline/offline-sync-engine";

/** Window event fired when the queue changes; detail is unused, listeners re-read the count. */
export const OFFLINE_QUEUE_CHANGED_EVENT = "uscc:offline-queue-changed";
/** Window event fired for each rejected action; detail is a RejectedAction. */
export const OFFLINE_ACTION_REJECTED_EVENT = "uscc:offline-action-rejected";

/** Outcome of a mutation sent through the offline fallback. */
export type OfflineAwareMutationOutcome =
  | { kind: "SENT"; isOk: boolean; status: number; body: unknown }
  | { kind: "QUEUED" }
  | { kind: "STORAGE_UNAVAILABLE" };

let currentUserId = "";
let syncEngine: OfflineSyncEngine | null = null;

/**
 * Sends one queued action with its original Idempotency-Key.
 *
 * @param queuedAction - The action.
 * @returns Network error or the response.
 */
async function sendQueuedAction(queuedAction: QueuedAction): Promise<SendOutcome> {
  try {
    const response = await fetch(queuedAction.path, {
      method: queuedAction.httpMethod,
      headers: { "Content-Type": "application/json", "Idempotency-Key": queuedAction.idempotencyKey, "X-CSRF-Token": readCsrfToken() },
      body: queuedAction.requestBody === undefined ? null : JSON.stringify(queuedAction.requestBody),
      credentials: "same-origin",
    });
    return { kind: "RESPONSE", status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return { kind: "NETWORK_ERROR" };
  }
}

/**
 * Returns the tab's engine, creating it on first use.
 *
 * @returns The engine.
 */
export function getOfflineSyncEngine(): OfflineSyncEngine {
  syncEngine ??= new OfflineSyncEngine({
    store: new IndexedDbOfflineActionStore(),
    sendQueuedAction,
    getCurrentUserId: () => currentUserId,
    onQueueChanged: () => window.dispatchEvent(new Event(OFFLINE_QUEUE_CHANGED_EVENT)),
    onActionRejected: (rejectedAction: RejectedAction) =>
      window.dispatchEvent(new CustomEvent<RejectedAction>(OFFLINE_ACTION_REJECTED_EVENT, { detail: rejectedAction })),
    scheduleRetry: (callback, delayMilliseconds) => window.setTimeout(callback, delayMilliseconds),
    cancelRetry: (timerHandle) => window.clearTimeout(timerHandle as number),
  });
  return syncEngine;
}

/**
 * Tells the runtime which arbiter is signed in, so only their actions are replayed.
 *
 * @param userId - Signed-in user ID.
 */
export function setOfflineQueueOwner(userId: string): void {
  currentUserId = userId;
}

/**
 * Sends a recorder mutation; when the network is down (or earlier actions are still queued) it is stored and
 * replayed later with the same Idempotency-Key (SRS-SYNC-01).
 *
 * @param mutation - Method, path, JSON body and a Vietnamese description for the badge.
 * @returns SENT with the response, QUEUED, or STORAGE_UNAVAILABLE when IndexedDB cannot be used.
 */
export async function sendMutationWithOfflineFallback(mutation: {
  httpMethod: QueuedAction["httpMethod"];
  path: string;
  requestBody: unknown;
  description: string;
}): Promise<OfflineAwareMutationOutcome> {
  const offlineSyncEngine = getOfflineSyncEngine();
  const idempotencyKey = generateIdempotencyKey();
  const queuedAction = { ...mutation, idempotencyKey, ownerUserId: currentUserId, createdAt: new Date().toISOString() };

  const hasEarlierQueuedActions = (await offlineSyncEngine.countPendingActions().catch(() => 0)) > 0;
  if (!hasEarlierQueuedActions) {
    const sendOutcome = await sendQueuedAction({ ...queuedAction, sequence: 0 });
    if (sendOutcome.kind === "RESPONSE") {
      return { kind: "SENT", isOk: sendOutcome.status >= 200 && sendOutcome.status < 300, status: sendOutcome.status, body: sendOutcome.body };
    }
  }
  try {
    await offlineSyncEngine.enqueueAction(queuedAction);
  } catch {
    return { kind: "STORAGE_UNAVAILABLE" };
  }
  void offlineSyncEngine.processQueue();
  return { kind: "QUEUED" };
}
