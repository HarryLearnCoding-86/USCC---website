// tests/unit/domain/phase-three-domain-rules.test.ts
// Unit tests for Phase 3 pure rules: retry backoff (AGENT_PROMPT.md §3.6, SRS-SYNC-01), projection paging
// (SRS-PROJ-06), logo type detection (SRS-TOUR-02), HH:mm:ss formatting (SRS-PROJ-05), SSE message format,
// NOTIFY payload parsing and the projected round choice.

import { describe, expect, it } from "vitest";
import { computeRetryDelayMilliseconds } from "@/server/domain/retry-backoff";
import { clampPageIntervalSeconds, computePageCount, computeRowsPerPage, selectPageItems } from "@/server/domain/projection-paging";
import { detectLogoFileType } from "@/server/domain/logo-file-rules";
import { formatTimeOfDayInTimezone } from "@/server/domain/date-time-format";
import { formatServerSentEvent } from "@/server/realtime/server-sent-events";
import { parseNotificationPayload } from "@/server/realtime/postgres-change-listener";
import { chooseProjectedRoundNumber } from "@/server/services/projection-service";

describe("computeRetryDelayMilliseconds (1 s doubling to 30 s)", () => {
  it.each([
    [0, 1_000],
    [1, 2_000],
    [2, 4_000],
    [4, 16_000],
    [5, 30_000],
    [50, 30_000],
    [-3, 1_000],
  ])("attempt %i → %i ms", (failedAttemptCount, expectedDelay) => {
    expect(computeRetryDelayMilliseconds(failedAttemptCount)).toBe(expectedDelay);
  });
});

describe("projection paging (SRS-PROJ-06)", () => {
  it("clamps the page interval to 5–30 s with a default of 10 s", () => {
    expect(clampPageIntervalSeconds(undefined)).toBe(10);
    expect(clampPageIntervalSeconds("abc")).toBe(10);
    expect(clampPageIntervalSeconds("2")).toBe(5);
    expect(clampPageIntervalSeconds("45")).toBe(30);
    expect(clampPageIntervalSeconds("12")).toBe(12);
  });

  it("computes rows, pages and wraps page indexes", () => {
    expect(computeRowsPerPage(820, 84)).toBe(9);
    expect(computeRowsPerPage(10, 84)).toBe(1);
    expect(computePageCount(0, 9)).toBe(1);
    expect(computePageCount(19, 9)).toBe(3);
    const boards = Array.from({ length: 19 }, (_unused, boardIndex) => boardIndex + 1);
    expect(selectPageItems(boards, 2, 9)).toEqual([19]);
    expect(selectPageItems(boards, 3, 9)).toEqual(boards.slice(0, 9));
  });
});

describe("detectLogoFileType (SRS-TOUR-02)", () => {
  it("recognises PNG, JPEG and SVG by content", () => {
    expect(detectLogoFileType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe("png");
    expect(detectLogoFileType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    const svgText = '﻿<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    expect(detectLogoFileType(new TextEncoder().encode(svgText))).toBe("svg");
  });

  it("rejects anything else, including HTML renamed to .svg", () => {
    expect(detectLogoFileType(new TextEncoder().encode("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(detectLogoFileType(new TextEncoder().encode("GIF89a"))).toBeNull();
    expect(detectLogoFileType(new Uint8Array([]))).toBeNull();
  });
});

describe("formatTimeOfDayInTimezone (SRS-PROJ-05)", () => {
  it("shows HH:mm:ss in the tournament timezone", () => {
    expect(formatTimeOfDayInTimezone(new Date("2026-10-30T17:05:09Z"), "Asia/Ho_Chi_Minh")).toBe("00:05:09");
  });
});

describe("SSE and NOTIFY helpers", () => {
  it("formats an SSE message", () => {
    expect(formatServerSentEvent("result_changed", { gameId: "g1" })).toBe('event: result_changed\ndata: {"gameId":"g1"}\n\n');
  });

  it("parses NOTIFY payloads and ignores unknown channels or junk", () => {
    expect(parseNotificationPayload("result_changed", '{"tournamentId":"t1","gameId":"g1","version":2}')).toEqual({
      type: "result_changed",
      tournamentId: "t1",
      gameId: "g1",
      version: 2,
    });
    expect(parseNotificationPayload("other_channel", '{"tournamentId":"t1"}')).toBeNull();
    expect(parseNotificationPayload("tournament_changed", "not json")).toBeNull();
    expect(parseNotificationPayload("tournament_changed", '{"noTournament":true}')).toBeNull();
  });
});

describe("chooseProjectedRoundNumber", () => {
  const rounds = [
    { roundNumber: 1, gameCount: 10 },
    { roundNumber: 2, gameCount: 10 },
    { roundNumber: 3, gameCount: 0 },
  ];

  it("uses the requested round when it exists, else the latest round with games", () => {
    expect(chooseProjectedRoundNumber(rounds, 1)).toBe(1);
    expect(chooseProjectedRoundNumber(rounds, 9)).toBe(2);
    expect(chooseProjectedRoundNumber(rounds, null)).toBe(2);
    expect(chooseProjectedRoundNumber([{ roundNumber: 1, gameCount: 0 }], null)).toBe(1);
  });
});
