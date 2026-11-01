// tests/unit/domain/tournament-logo-url.test.ts
// Unit tests for the logo URL: none without a logo, and a version parameter that changes with each upload.

import { describe, expect, it } from "vitest";
import { buildTournamentLogoUrl } from "@/server/domain/tournament-logo-url";

describe("buildTournamentLogoUrl", () => {
  it("returns null when the tournament has no logo", () => {
    expect(buildTournamentLogoUrl("t1", null)).toBeNull();
  });

  it("points at the authenticated logo route with the storage key as an escaped version", () => {
    expect(buildTournamentLogoUrl("t1", "tournaments/t1/logo 2.png")).toBe("/api/tournaments/t1/logo?v=tournaments%2Ft1%2Flogo%202.png");
  });
});
