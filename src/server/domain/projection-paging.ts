// src/server/domain/projection-paging.ts
// Paging rules for the projection screen (SRS-PROJ-06): when games exceed one screen, pages rotate every 10 s
// by default, configurable between 5 and 30 s. Pure, so the client component and unit tests share it.

/** SRS-PROJ-06 default page interval. */
export const DEFAULT_PAGE_INTERVAL_SECONDS = 10;
export const MINIMUM_PAGE_INTERVAL_SECONDS = 5;
export const MAXIMUM_PAGE_INTERVAL_SECONDS = 30;

/**
 * Parses and clamps a page interval from a URL parameter.
 *
 * @param requestedSeconds - Raw value, e.g. from ?pageSeconds=; anything non-numeric gives the default.
 * @returns Seconds between 5 and 30.
 */
export function clampPageIntervalSeconds(requestedSeconds: string | number | null | undefined): number {
  const parsedSeconds = Number(requestedSeconds);
  if (requestedSeconds === null || requestedSeconds === undefined || requestedSeconds === "" || !Number.isFinite(parsedSeconds)) {
    return DEFAULT_PAGE_INTERVAL_SECONDS;
  }
  return Math.min(MAXIMUM_PAGE_INTERVAL_SECONDS, Math.max(MINIMUM_PAGE_INTERVAL_SECONDS, Math.round(parsedSeconds)));
}

/**
 * How many rows fit on screen.
 *
 * @param availableHeightPixels - Height left for the table body.
 * @param rowHeightPixels - Height of one row.
 * @returns At least 1.
 */
export function computeRowsPerPage(availableHeightPixels: number, rowHeightPixels: number): number {
  if (rowHeightPixels <= 0) return 1;
  return Math.max(1, Math.floor(availableHeightPixels / rowHeightPixels));
}

/**
 * Number of pages for a list.
 *
 * @param itemCount - Total rows.
 * @param rowsPerPage - Rows per page (≥ 1).
 * @returns At least 1, so an empty list still has one (empty) page.
 */
export function computePageCount(itemCount: number, rowsPerPage: number): number {
  return Math.max(1, Math.ceil(itemCount / Math.max(1, rowsPerPage)));
}

/**
 * Slice of items on a page; the page index wraps so a shrinking list never shows an empty page.
 *
 * @param items - All rows.
 * @param pageIndex - Zero-based page index (may exceed the page count).
 * @param rowsPerPage - Rows per page.
 * @returns Rows of that page.
 */
export function selectPageItems<TItem>(items: readonly TItem[], pageIndex: number, rowsPerPage: number): TItem[] {
  const pageCount = computePageCount(items.length, rowsPerPage);
  const wrappedPageIndex = ((pageIndex % pageCount) + pageCount) % pageCount;
  const safeRowsPerPage = Math.max(1, rowsPerPage);
  return items.slice(wrappedPageIndex * safeRowsPerPage, (wrappedPageIndex + 1) * safeRowsPerPage);
}
