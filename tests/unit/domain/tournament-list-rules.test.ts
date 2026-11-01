// tests/unit/domain/tournament-list-rules.test.ts
// Unit tests for the tournament list rules: default newest-first order, every sort option, diacritic-insensitive
// search, and 15-per-page paging with clamping.

import { describe, expect, it } from "vitest";
import {
  selectTournamentListPage,
  TOURNAMENT_LIST_PAGE_SIZE,
  type TournamentListFields,
  type TournamentSortOption,
} from "@/server/domain/tournament-list-rules";

/** A tournament with defaults. */
function buildTournament(overrides: Partial<TournamentListFields> & { id: string }): TournamentListFields {
  return { name: `Giải ${overrides.id}`, venue: null, organizer: null, startDateIso: "2026-01-01", winCount: 0, drawCount: 0, ...overrides };
}

const SAMPLE_TOURNAMENTS = [
  buildTournament({ id: "c", name: "Giải Mùa Xuân", startDateIso: "2026-03-01", winCount: 5, drawCount: 9 }),
  buildTournament({ id: "a", name: "Cờ nhanh Quận 1", startDateIso: "2026-06-15", winCount: 20, drawCount: 1, venue: "Nhà văn hóa Quận 1" }),
  buildTournament({ id: "b", name: "Bế mạc hè", startDateIso: "2025-08-01", winCount: 12, drawCount: 4, organizer: "USCC" }),
];

/**
 * Sorted IDs for a sort option.
 *
 * @param sortOption - Order.
 * @returns IDs on page 1.
 */
function sortedIds(sortOption: TournamentSortOption): string[] {
  return selectTournamentListPage(SAMPLE_TOURNAMENTS, { searchText: "", sortOption, pageNumber: 1 }).items.map((tournament) => tournament.id);
}

describe("selectTournamentListPage sorting", () => {
  it("orders by start date, newest first, by default and oldest first on request", () => {
    expect(sortedIds("date-desc")).toEqual(["a", "c", "b"]);
    expect(sortedIds("date-asc")).toEqual(["b", "c", "a"]);
  });

  it("orders by name (Vietnamese collation), ID, most wins and most draws", () => {
    expect(sortedIds("name-asc")).toEqual(["b", "a", "c"]);
    expect(sortedIds("id-asc")).toEqual(["a", "b", "c"]);
    expect(sortedIds("wins-desc")).toEqual(["a", "b", "c"]);
    expect(sortedIds("draws-desc")).toEqual(["c", "b", "a"]);
  });

  it("breaks ties by newest date", () => {
    const tiedTournaments = [
      buildTournament({ id: "old", startDateIso: "2025-01-01", winCount: 3 }),
      buildTournament({ id: "new", startDateIso: "2026-01-01", winCount: 3 }),
    ];
    const tiedPage = selectTournamentListPage(tiedTournaments, { searchText: "", sortOption: "wins-desc", pageNumber: 1 });
    expect(tiedPage.items.map((tournament) => tournament.id)).toEqual(["new", "old"]);
  });
});

describe("selectTournamentListPage search", () => {
  it("matches name, venue and organizer without diacritics or case, word by word", () => {
    const search = (searchText: string) =>
      selectTournamentListPage(SAMPLE_TOURNAMENTS, { searchText, sortOption: "date-desc", pageNumber: 1 }).items.map((tournament) => tournament.id);
    expect(search("mua xuan")).toEqual(["c"]);
    expect(search("NHA VAN HOA")).toEqual(["a"]);
    expect(search("uscc")).toEqual(["b"]);
    expect(search("quan 1 nhanh")).toEqual(["a"]);
    expect(search("   ")).toHaveLength(3);
    expect(search("không có")).toEqual([]);
  });
});

describe("selectTournamentListPage paging", () => {
  const manyTournaments = Array.from({ length: 32 }, (_unused, index) =>
    buildTournament({ id: `t${String(index).padStart(2, "0")}`, startDateIso: `2026-01-${String(index + 1).padStart(2, "0")}` }),
  );

  it("shows 15 per page and reports the page count", () => {
    const firstPage = selectTournamentListPage(manyTournaments, { searchText: "", sortOption: "date-desc", pageNumber: 1 });
    expect(TOURNAMENT_LIST_PAGE_SIZE).toBe(15);
    expect(firstPage.items).toHaveLength(15);
    expect(firstPage.items[0]?.id).toBe("t31");
    expect(firstPage).toMatchObject({ matchingCount: 32, pageNumber: 1, pageCount: 3 });
    const lastPage = selectTournamentListPage(manyTournaments, { searchText: "", sortOption: "date-desc", pageNumber: 3 });
    expect(lastPage.items.map((tournament) => tournament.id)).toEqual(["t01", "t00"]);
  });

  it("clamps out-of-range pages and keeps one empty page when nothing matches", () => {
    expect(selectTournamentListPage(manyTournaments, { searchText: "", sortOption: "date-desc", pageNumber: 99 }).pageNumber).toBe(3);
    expect(selectTournamentListPage(manyTournaments, { searchText: "", sortOption: "date-desc", pageNumber: 0 }).pageNumber).toBe(1);
    expect(selectTournamentListPage([], { searchText: "", sortOption: "date-desc", pageNumber: 2 })).toEqual({
      items: [],
      matchingCount: 0,
      pageNumber: 1,
      pageCount: 1,
    });
  });
});
