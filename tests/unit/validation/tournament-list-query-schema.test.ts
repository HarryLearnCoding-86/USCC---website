// tests/unit/validation/tournament-list-query-schema.test.ts
// Unit tests for reading the tournament list query from the URL: defaults, valid values, and lenient fallbacks.

import { describe, expect, it } from "vitest";
import { parseTournamentListQuery } from "@/server/validation/tournament-list-query-schema";

describe("parseTournamentListQuery", () => {
  it("defaults to no search, newest first, page 1", () => {
    expect(parseTournamentListQuery({})).toEqual({ searchText: "", sortOption: "date-desc", pageNumber: 1 });
  });

  it("reads valid values and the first of repeated keys", () => {
    expect(parseTournamentListQuery({ q: "mùa xuân", sort: "draws-desc", page: "3" })).toEqual({ searchText: "mùa xuân", sortOption: "draws-desc", pageNumber: 3 });
    expect(parseTournamentListQuery({ sort: ["name-asc", "id-asc"] }).sortOption).toBe("name-asc");
  });

  it("falls back to defaults for unknown sorts and bad pages, and cuts long searches", () => {
    expect(parseTournamentListQuery({ sort: "random", page: "-2" })).toEqual({ searchText: "", sortOption: "date-desc", pageNumber: 1 });
    expect(parseTournamentListQuery({ page: "abc" }).pageNumber).toBe(1);
    expect(parseTournamentListQuery({ q: "x".repeat(500) }).searchText).toHaveLength(100);
  });
});
