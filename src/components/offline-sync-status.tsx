// src/components/offline-sync-status.tsx
// Header badge "Chưa đồng bộ (N)" while recorder actions wait in the offline queue (SRS-SYNC-02), with a tap to
// retry immediately, and notices for actions the server rejected on replay (SRS-SYNC-04). Also starts the sync
// engine for the signed-in arbiter: on page load, when the browser comes back online, and every 30 s as a fallback.

"use client";

import { useEffect, useState } from "react";
import { vi } from "@/i18n/vi";
import type { RejectedAction } from "@/client/offline/offline-sync-engine";
import {
  getOfflineSyncEngine,
  OFFLINE_ACTION_REJECTED_EVENT,
  OFFLINE_QUEUE_CHANGED_EVENT,
  setOfflineQueueOwner,
} from "@/client/offline/offline-sync-runtime";

/** Fallback poll so a forgotten queue drains even without an "online" event. */
const FALLBACK_SYNC_INTERVAL_MILLISECONDS = 30_000;

/**
 * Offline sync badge and rejection notices.
 *
 * @param props.signedInUserId - The arbiter whose queued actions this tab replays.
 * @returns The badge (hidden when nothing is queued) and any rejection notices.
 */
export function OfflineSyncStatus({ signedInUserId }: { signedInUserId: string }) {
  const [pendingActionCount, setPendingActionCount] = useState(0);
  const [rejectionNotices, setRejectionNotices] = useState<{ noticeId: string; text: string }[]>([]);

  useEffect(() => {
    setOfflineQueueOwner(signedInUserId);
    const offlineSyncEngine = getOfflineSyncEngine();
    const refreshCount = () => {
      offlineSyncEngine
        .countPendingActions()
        .then(setPendingActionCount)
        .catch(() => setPendingActionCount(0));
    };
    const handleRejection = (rejectionEvent: Event) => {
      const { queuedAction, messageVi } = (rejectionEvent as CustomEvent<RejectedAction>).detail;
      setRejectionNotices((currentNotices) => [
        ...currentNotices,
        { noticeId: queuedAction.idempotencyKey, text: vi.offlineQueue.rejectedNotice(queuedAction.description, messageVi ?? vi.common.error) },
      ]);
    };
    const processQueue = () => void offlineSyncEngine.processQueue().catch(() => undefined);

    window.addEventListener(OFFLINE_QUEUE_CHANGED_EVENT, refreshCount);
    window.addEventListener(OFFLINE_ACTION_REJECTED_EVENT, handleRejection);
    window.addEventListener("online", processQueue);
    const fallbackTimer = window.setInterval(processQueue, FALLBACK_SYNC_INTERVAL_MILLISECONDS);
    refreshCount();
    processQueue();
    return () => {
      window.removeEventListener(OFFLINE_QUEUE_CHANGED_EVENT, refreshCount);
      window.removeEventListener(OFFLINE_ACTION_REJECTED_EVENT, handleRejection);
      window.removeEventListener("online", processQueue);
      window.clearInterval(fallbackTimer);
    };
  }, [signedInUserId]);

  return (
    <>
      {pendingActionCount > 0 && (
        <button
          type="button"
          data-testid="offline-sync-badge"
          title={vi.offlineQueue.retryNow}
          onClick={() => void getOfflineSyncEngine().processQueue()}
          className="min-h-[44px] rounded-full bg-amber-500 px-3 text-sm font-semibold text-white"
        >
          {vi.offlineQueue.unsyncedBadge(pendingActionCount)}
        </button>
      )}
      {rejectionNotices.length > 0 && (
        <div className="fixed inset-x-2 bottom-2 z-50 flex flex-col gap-2 sm:left-auto sm:w-96">
          {rejectionNotices.map((rejectionNotice) => (
            <div key={rejectionNotice.noticeId} role="alert" className="flex items-start gap-2 rounded-md bg-red-700 p-3 text-sm text-white shadow-lg">
              <p className="flex-1">{rejectionNotice.text}</p>
              <button
                type="button"
                className="min-h-[44px] rounded bg-white/20 px-2"
                onClick={() => setRejectionNotices((currentNotices) => currentNotices.filter((notice) => notice.noticeId !== rejectionNotice.noticeId))}
              >
                {vi.offlineQueue.dismiss}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
