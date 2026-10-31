// src/server/http/page-data-loaders.ts
// Helpers for server-rendered pages that turn a service's 404 ApiError into Next.js notFound(),
// so a mistyped tournament, round or game URL shows the Vietnamese 404 page instead of an error.

import { notFound } from "next/navigation";
import { ApiError } from "@/server/http/api-error";

/**
 * Runs a page data loader and maps 404 ApiErrors to notFound().
 *
 * @param loadPageData - Service call that may throw ApiError(404).
 * @returns The loaded data.
 * @throws Next.js notFound signal for 404; rethrows anything else.
 */
export async function loadOrNotFound<TPageData>(loadPageData: () => Promise<TPageData>): Promise<TPageData> {
  try {
    return await loadPageData();
  } catch (error) {
    if (error instanceof ApiError && error.httpStatus === 404) {
      notFound();
    }
    throw error;
  }
}

/**
 * Parses a positive integer route segment such as a round number.
 *
 * @param segmentValue - Raw segment text.
 * @returns The number.
 * @throws Next.js notFound signal when the segment is not a positive integer.
 */
export function parsePositiveIntegerSegment(segmentValue: string): number {
  const parsedNumber = Number(segmentValue);
  if (!Number.isInteger(parsedNumber) || parsedNumber < 1) {
    notFound();
  }
  return parsedNumber;
}
