// src/server/domain/date-time-format.ts
// Date and time formatting for arbiters: DD/MM/YYYY dates and 24-hour times (NFR-11),
// with instants converted to the tournament's IANA timezone (RULE-13). Pure, so client and server share it.

/** Timezone used when no tournament is in context (e.g. account pages). */
export const DEFAULT_TIMEZONE = "Asia/Ho_Chi_Minh";

/**
 * Formats a calendar date stored as a PostgreSQL DATE (Prisma returns it as UTC midnight).
 * Reading UTC parts avoids shifting the day when the viewer's local zone is behind UTC.
 *
 * @param calendarDate - Date at UTC midnight.
 * @returns "DD/MM/YYYY".
 */
export function formatCalendarDate(calendarDate: Date): string {
  const day = String(calendarDate.getUTCDate()).padStart(2, "0");
  const month = String(calendarDate.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${calendarDate.getUTCFullYear()}`;
}

/**
 * Formats an instant in a given timezone.
 *
 * @param instant - A point in time (stored as timestamptz).
 * @param timeZone - IANA timezone name, e.g. "Asia/Ho_Chi_Minh".
 * @returns "DD/MM/YYYY HH:mm" in 24-hour time.
 * @throws RangeError when timeZone is not a valid IANA name.
 */
export function formatInstantInTimezone(instant: Date, timeZone: string): string {
  const dateParts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const partValue = (partType: Intl.DateTimeFormatPartTypes): string =>
    dateParts.find((datePart) => datePart.type === partType)?.value ?? "";
  return `${partValue("day")}/${partValue("month")}/${partValue("year")} ${partValue("hour")}:${partValue("minute")}`;
}
