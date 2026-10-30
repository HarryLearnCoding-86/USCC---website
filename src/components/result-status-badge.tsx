// src/components/result-status-badge.tsx
// Coloured badge for a result status, with the Vietnamese label from vi.ts. Colour is a cue only;
// the text label always carries the meaning (NFR-10).

import type { ResultStatus } from "@prisma/client";
import { vi } from "@/i18n/vi";

const STATUS_CLASS_NAMES: Record<ResultStatus, string> = {
  NONE: "bg-gray-100 text-gray-700",
  PENDING: "bg-amber-100 text-amber-900",
  DISPUTED: "bg-red-100 text-red-800",
  OFFICIAL: "bg-green-100 text-green-800",
  REOPENED: "bg-blue-100 text-blue-800",
};

/**
 * Status badge.
 *
 * @param props.status - Result status.
 * @returns A small pill with the Vietnamese status label.
 */
export function ResultStatusBadge({ status }: { status: ResultStatus }) {
  return (
    <span data-testid="result-status" className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS_NAMES[status]}`}>
      {vi.resultStatus[status]}
    </span>
  );
}
