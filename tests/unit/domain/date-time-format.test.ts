// tests/unit/domain/date-time-format.test.ts
// Unit tests for DD/MM/YYYY dates and 24-hour times in the tournament timezone (NFR-11, RULE-13).

import { describe, expect, it } from "vitest";
import { formatCalendarDate, formatInstantInTimezone } from "@/server/domain/date-time-format";

describe("formatCalendarDate", () => {
  it("formats a DATE column value as DD/MM/YYYY without shifting the day", () => {
    expect(formatCalendarDate(new Date("2026-03-05T00:00:00Z"))).toBe("05/03/2026");
  });
});

describe("formatInstantInTimezone", () => {
  it("converts UTC to Asia/Ho_Chi_Minh (UTC+7) in 24-hour time", () => {
    expect(formatInstantInTimezone(new Date("2026-10-30T13:05:00Z"), "Asia/Ho_Chi_Minh")).toBe("30/10/2026 20:05");
  });

  it("rolls over the date when the timezone crosses midnight", () => {
    expect(formatInstantInTimezone(new Date("2026-10-30T18:30:00Z"), "Asia/Ho_Chi_Minh")).toBe("31/10/2026 01:30");
  });

  it("renders midnight as 00, not 24", () => {
    expect(formatInstantInTimezone(new Date("2026-10-30T17:00:00Z"), "Asia/Ho_Chi_Minh")).toBe("31/10/2026 00:00");
  });

  it("throws for an invalid timezone name", () => {
    expect(() => formatInstantInTimezone(new Date(), "Not/AZone")).toThrow(RangeError);
  });
});
