// tests/unit/client/offline-sync-engine.test.ts
// Unit tests for the offline queue engine (SRS-SYNC-01..04) with an in-memory store and a scripted transport:
// in-order replay with the original key, stop-and-backoff on network errors and 5xx, drop-and-report on 4xx,
// keep on 401, and owner filtering.

import { describe, expect, it } from "vitest";
import type { OfflineActionStore, QueuedAction } from "@/client/offline/offline-action-store";
import { OfflineSyncEngine, type RejectedAction, type SendOutcome } from "@/client/offline/offline-sync-engine";

/** In-memory OfflineActionStore. */
class InMemoryOfflineActionStore implements OfflineActionStore {
  readonly actionsByKey = new Map<string, QueuedAction>();
  async appendAction(queuedAction: QueuedAction) {
    this.actionsByKey.set(queuedAction.idempotencyKey, queuedAction);
  }
  async listActionsInOrder() {
    return [...this.actionsByKey.values()].sort((first, second) => first.sequence - second.sequence);
  }
  async removeAction(idempotencyKey: string) {
    this.actionsByKey.delete(idempotencyKey);
  }
}

/**
 * Builds an engine whose transport answers from a script, recording what was sent and scheduled.
 *
 * @param scriptedOutcomes - Outcomes returned in order; the last one repeats.
 * @param currentUserId - Signed-in user.
 * @returns Engine plus inspection handles.
 */
function buildEngine(scriptedOutcomes: SendOutcome[], currentUserId = "recorder-1") {
  const store = new InMemoryOfflineActionStore();
  const sentKeys: string[] = [];
  const scheduledDelays: number[] = [];
  const rejectedActions: RejectedAction[] = [];
  let outcomeIndex = 0;
  const engine = new OfflineSyncEngine({
    store,
    sendQueuedAction: async (queuedAction) => {
      sentKeys.push(queuedAction.idempotencyKey);
      const outcome = scriptedOutcomes[Math.min(outcomeIndex, scriptedOutcomes.length - 1)] as SendOutcome;
      outcomeIndex += 1;
      return outcome;
    },
    getCurrentUserId: () => currentUserId,
    onQueueChanged: () => undefined,
    onActionRejected: (rejectedAction) => rejectedActions.push(rejectedAction),
    scheduleRetry: (_callback, delayMilliseconds) => {
      scheduledDelays.push(delayMilliseconds);
      return scheduledDelays.length;
    },
    cancelRetry: () => undefined,
  });
  return { engine, store, sentKeys, scheduledDelays, rejectedActions };
}

/**
 * Builds a queued action without a sequence.
 *
 * @param idempotencyKey - Key.
 * @param ownerUserId - Owner.
 * @returns The action.
 */
function makeAction(idempotencyKey: string, ownerUserId = "recorder-1"): Omit<QueuedAction, "sequence"> {
  return {
    idempotencyKey,
    httpMethod: "POST",
    path: `/api/games/g1/${idempotencyKey}`,
    requestBody: { version: 0 },
    description: `Thao tác ${idempotencyKey}`,
    ownerUserId,
    createdAt: new Date().toISOString(),
  };
}

const OK: SendOutcome = { kind: "RESPONSE", status: 200, body: {} };
const NETWORK_ERROR: SendOutcome = { kind: "NETWORK_ERROR" };

describe("OfflineSyncEngine", () => {
  it("replays actions in queue order with their original keys and empties the queue", async () => {
    const { engine, sentKeys } = buildEngine([OK]);
    await engine.enqueueAction(makeAction("submit"));
    await engine.enqueueAction(makeAction("confirm-white"));
    await engine.enqueueAction(makeAction("confirm-black"));
    const summary = await engine.processQueue();
    expect(sentKeys).toEqual(["submit", "confirm-white", "confirm-black"]);
    expect(summary).toMatchObject({ appliedCount: 3, rejectedCount: 0, remainingCount: 0, isRetryScheduled: false });
  });

  it("stops at a network error, keeps the rest and backs off 1 s, 2 s, 4 s", async () => {
    const { engine, sentKeys, scheduledDelays } = buildEngine([NETWORK_ERROR]);
    await engine.enqueueAction(makeAction("submit"));
    await engine.enqueueAction(makeAction("confirm-white"));
    for (let attemptIndex = 0; attemptIndex < 3; attemptIndex++) {
      const summary = await engine.processQueue();
      expect(summary).toMatchObject({ appliedCount: 0, remainingCount: 2, isRetryScheduled: true });
    }
    // Never skips ahead: only the first action is attempted while it fails.
    expect(sentKeys).toEqual(["submit", "submit", "submit"]);
    expect(scheduledDelays).toEqual([1_000, 2_000, 4_000]);
  });

  it("treats 5xx and 429 as retryable", async () => {
    for (const status of [500, 503, 429]) {
      const { engine } = buildEngine([{ kind: "RESPONSE", status, body: {} }]);
      await engine.enqueueAction(makeAction("submit"));
      expect(await engine.processQueue()).toMatchObject({ remainingCount: 1, isRetryScheduled: true });
    }
  });

  it("drops a rejected action, reports the server's reason and continues (SRS-SYNC-04)", async () => {
    const conflict: SendOutcome = { kind: "RESPONSE", status: 409, body: { code: "VERSION_CONFLICT", messageVi: "Kết quả đã thay đổi. Vui lòng tải lại." } };
    const { engine, rejectedActions } = buildEngine([conflict, OK]);
    await engine.enqueueAction(makeAction("stale-confirm"));
    await engine.enqueueAction(makeAction("other"));
    const summary = await engine.processQueue();
    expect(summary).toMatchObject({ appliedCount: 1, rejectedCount: 1, remainingCount: 0 });
    expect(rejectedActions[0]).toMatchObject({ status: 409, messageVi: "Kết quả đã thay đổi. Vui lòng tải lại.", queuedAction: { idempotencyKey: "stale-confirm" } });
  });

  it("keeps everything on 401 until the arbiter signs in again", async () => {
    const { engine, rejectedActions } = buildEngine([{ kind: "RESPONSE", status: 401, body: {} }]);
    await engine.enqueueAction(makeAction("submit"));
    expect(await engine.processQueue()).toMatchObject({ remainingCount: 1, rejectedCount: 0, isRetryScheduled: false });
    expect(rejectedActions).toHaveLength(0);
  });

  it("replays only the signed-in arbiter's actions", async () => {
    const { engine, store, sentKeys } = buildEngine([OK], "recorder-2");
    await engine.enqueueAction(makeAction("from-recorder-1", "recorder-1"));
    await engine.enqueueAction(makeAction("from-recorder-2", "recorder-2"));
    expect(await engine.countPendingActions()).toBe(1);
    await engine.processQueue();
    expect(sentKeys).toEqual(["from-recorder-2"]);
    expect([...store.actionsByKey.keys()]).toEqual(["from-recorder-1"]);
  });

  it("resets the backoff after a success", async () => {
    const { engine, scheduledDelays } = buildEngine([NETWORK_ERROR, OK, NETWORK_ERROR]);
    await engine.enqueueAction(makeAction("first"));
    await engine.processQueue();
    await engine.processQueue();
    await engine.enqueueAction(makeAction("second"));
    await engine.processQueue();
    expect(scheduledDelays).toEqual([1_000, 1_000]);
  });
});
