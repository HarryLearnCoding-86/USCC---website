// src/client/offline/offline-sync-engine.ts
// Replays queued actions in order (SRS-SYNC-01..04). Each action keeps its original Idempotency-Key, so a retry of
// a request whose response was lost is answered from the server's stored response and never applied twice.
// Outcomes per action:
//   2xx                       → applied, removed from the queue;
//   network error, 408/429/5xx → stop, retry later with backoff (1 s doubling to 30 s);
//   401                       → stop and keep (the arbiter must sign in again; nothing is lost);
//   other 4xx (e.g. 409 stale) → dropped, and the reason is reported to the arbiter (never retried forever).
// Framework-free: storage, transport and timers are injected so it is unit-testable.

import { computeRetryDelayMilliseconds } from "@/server/domain/retry-backoff";
import type { OfflineActionStore, QueuedAction } from "@/client/offline/offline-action-store";

/** Result of sending one action. */
export type SendOutcome = { kind: "NETWORK_ERROR" } | { kind: "RESPONSE"; status: number; body: unknown };

/** A queued action the server refused. */
export interface RejectedAction {
  queuedAction: QueuedAction;
  status: number;
  messageVi: string | null;
}

/** Dependencies of the engine. */
export interface OfflineSyncEngineDependencies {
  store: OfflineActionStore;
  /** Sends one action with its Idempotency-Key. Must not throw. */
  sendQueuedAction: (queuedAction: QueuedAction) => Promise<SendOutcome>;
  /** Returns the signed-in arbiter's ID; only their actions are replayed. */
  getCurrentUserId: () => string;
  /** Called whenever the queue may have changed. */
  onQueueChanged: () => void;
  /** Called for each dropped action. */
  onActionRejected: (rejectedAction: RejectedAction) => void;
  /** Timer functions (injectable for tests). */
  scheduleRetry: (callback: () => void, delayMilliseconds: number) => unknown;
  cancelRetry: (timerHandle: unknown) => void;
}

/** Summary of one processing pass, for tests and diagnostics. */
export interface ProcessingSummary {
  appliedCount: number;
  rejectedCount: number;
  remainingCount: number;
  isRetryScheduled: boolean;
}

/** Retryable HTTP statuses: the request may succeed later without any change. */
const RETRYABLE_STATUSES = new Set([408, 429]);

/** Replays the offline queue. */
export class OfflineSyncEngine {
  private isProcessing = false;
  private hasPendingRun = false;
  private failedAttemptCount = 0;
  private retryTimerHandle: unknown = null;
  private nextSequence = Date.now();

  /**
   * @param dependencies - Store, transport, current user, callbacks and timers.
   */
  constructor(private readonly dependencies: OfflineSyncEngineDependencies) {}

  /**
   * Adds an action to the end of the queue and starts processing.
   *
   * @param queuedAction - Action without a sequence number.
   */
  async enqueueAction(queuedAction: Omit<QueuedAction, "sequence">): Promise<void> {
    // Date-based start keeps order across reloads; the counter keeps order within one millisecond.
    this.nextSequence = Math.max(this.nextSequence + 1, Date.now());
    await this.dependencies.store.appendAction({ ...queuedAction, sequence: this.nextSequence });
    this.dependencies.onQueueChanged();
  }

  /**
   * Number of actions waiting for the current arbiter.
   *
   * @returns Count shown in the "Chưa đồng bộ (N)" badge.
   */
  async countPendingActions(): Promise<number> {
    const currentUserId = this.dependencies.getCurrentUserId();
    return (await this.dependencies.store.listActionsInOrder()).filter((queuedAction) => queuedAction.ownerUserId === currentUserId).length;
  }

  /**
   * Sends queued actions in order until the queue is empty or a retryable failure stops the pass.
   * Concurrent calls are merged: a call during a pass schedules one more pass afterwards.
   *
   * @returns What happened in this pass.
   */
  async processQueue(): Promise<ProcessingSummary> {
    if (this.isProcessing) {
      this.hasPendingRun = true;
      return { appliedCount: 0, rejectedCount: 0, remainingCount: await this.countPendingActions(), isRetryScheduled: this.retryTimerHandle !== null };
    }
    this.isProcessing = true;
    this.clearRetryTimer();
    const summary: ProcessingSummary = { appliedCount: 0, rejectedCount: 0, remainingCount: 0, isRetryScheduled: false };
    try {
      do {
        this.hasPendingRun = false;
        const shouldStop = await this.runOnePass(summary);
        if (shouldStop) break;
      } while (this.hasPendingRun);
    } finally {
      this.isProcessing = false;
      summary.remainingCount = await this.countPendingActions();
      summary.isRetryScheduled = this.retryTimerHandle !== null;
      this.dependencies.onQueueChanged();
    }
    return summary;
  }

  /**
   * One pass over the current queue.
   *
   * @param summary - Counters to update.
   * @returns true when processing must stop (retry scheduled or sign-in needed).
   */
  private async runOnePass(summary: ProcessingSummary): Promise<boolean> {
    const currentUserId = this.dependencies.getCurrentUserId();
    const queuedActions = (await this.dependencies.store.listActionsInOrder()).filter((queuedAction) => queuedAction.ownerUserId === currentUserId);
    for (const queuedAction of queuedActions) {
      const sendOutcome = await this.dependencies.sendQueuedAction(queuedAction);
      if (sendOutcome.kind === "NETWORK_ERROR" || this.isRetryableStatus(sendOutcome.status)) {
        this.scheduleRetryWithBackoff();
        return true;
      }
      if (sendOutcome.status === 401) {
        // Session expired: keep everything and wait for the arbiter to sign in again.
        return true;
      }
      this.failedAttemptCount = 0;
      await this.dependencies.store.removeAction(queuedAction.idempotencyKey);
      if (sendOutcome.status >= 200 && sendOutcome.status < 300) {
        summary.appliedCount += 1;
      } else {
        summary.rejectedCount += 1;
        const responseBody = sendOutcome.body as { messageVi?: unknown } | null;
        this.dependencies.onActionRejected({
          queuedAction,
          status: sendOutcome.status,
          messageVi: typeof responseBody?.messageVi === "string" ? responseBody.messageVi : null,
        });
      }
      this.dependencies.onQueueChanged();
    }
    return false;
  }

  /**
   * Whether a status means "try again later".
   *
   * @param status - HTTP status.
   * @returns true for 408, 429 and 5xx.
   */
  private isRetryableStatus(status: number): boolean {
    return RETRYABLE_STATUSES.has(status) || status >= 500;
  }

  private scheduleRetryWithBackoff(): void {
    const retryDelay = computeRetryDelayMilliseconds(this.failedAttemptCount);
    this.failedAttemptCount += 1;
    this.retryTimerHandle = this.dependencies.scheduleRetry(() => {
      this.retryTimerHandle = null;
      void this.processQueue();
    }, retryDelay);
  }

  private clearRetryTimer(): void {
    if (this.retryTimerHandle !== null) {
      this.dependencies.cancelRetry(this.retryTimerHandle);
      this.retryTimerHandle = null;
    }
  }
}
