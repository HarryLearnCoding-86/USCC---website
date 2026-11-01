// tests/e2e/helpers/e2e-api-helpers.ts
// Helpers for end-to-end tests: sign in through the API, build a fresh tournament with boards as the TD, and drive
// result actions through the real API, so each test owns its data and can be re-run against the seeded dev
// database without cleanup. Player names are fictional (CLAUDE.md §2).

import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext } from "@playwright/test";

/** Demo credentials from the seed (overridable with SEED_* env vars). */
export const E2E_ACCOUNTS = {
  technical: { username: process.env.SEED_TD_USERNAME ?? "td_demo", password: process.env.SEED_TD_PASSWORD ?? "TdDemo-2026!" },
  recorder: { username: process.env.SEED_RECORDER_USERNAME ?? "recorder_demo", password: process.env.SEED_RECORDER_PASSWORD ?? "RecDemo-2026!" },
};

const E2E_ORIGIN = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Sends a JSON mutation the way the app does: same Origin, fresh Idempotency-Key, CSRF token from the cookie.
 *
 * @param request - Playwright request context (carries the session cookie).
 * @param httpMethod - POST, PUT, PATCH or DELETE.
 * @param path - API path.
 * @param requestBody - JSON body.
 * @returns Parsed JSON body; fails the test on a non-2xx response.
 */
export async function sendE2eMutation(request: APIRequestContext, httpMethod: "POST" | "PUT" | "PATCH" | "DELETE", path: string, requestBody: unknown) {
  // The CSRF token lives in the readable cookie the login response set (SRS §10.2).
  const { cookies } = await request.storageState();
  const csrfToken = cookies.find((cookie) => cookie.name === "uscc_csrf")?.value ?? "";
  const response = await request.fetch(path, {
    method: httpMethod,
    headers: { origin: E2E_ORIGIN, "content-type": "application/json", "idempotency-key": randomUUID(), "x-csrf-token": csrfToken },
    data: requestBody,
  });
  expect(response.ok(), `${httpMethod} ${path} → ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as Record<string, unknown>;
}

/**
 * Signs in through the login API so the context's cookie jar holds the session.
 *
 * @param request - Request context of a browser context.
 * @param account - Username and password.
 */
export async function signInThroughApi(request: APIRequestContext, account: { username: string; password: string }) {
  const response = await request.post("/api/auth/login", { headers: { origin: E2E_ORIGIN }, data: account });
  expect(response.status()).toBe(200);
}

/** One board of the test tournament. */
export interface E2eBoard {
  boardNumber: number;
  gameId: string;
  whitePlayerName: string;
  blackPlayerName: string;
}

/** IDs and names of the tournament built for a test. */
export interface E2eTournament {
  tournamentId: string;
  /** Names on board 1, kept for the Phase 2 specs. */
  whitePlayerName: string;
  blackPlayerName: string;
  boards: E2eBoard[];
  resultCodeIdByCode: Record<string, string>;
}

/**
 * Creates a one-round tournament with boards 1..boardCount through the TD API.
 *
 * @param technicalRequest - Request context signed in as the TD.
 * @param boardCount - Number of two-player boards (default 1; 0 leaves the round empty for import tests).
 * @returns Tournament ID, boards with game IDs and names, and result code IDs.
 */
export async function createE2eTournament(technicalRequest: APIRequestContext, boardCount = 1): Promise<E2eTournament> {
  const uniqueSuffix = randomUUID().slice(0, 6);
  const createdTournament = (await sendE2eMutation(technicalRequest, "POST", "/api/tournaments", {
    name: `Giải E2E ${uniqueSuffix}`,
    startDate: "2026-11-01",
    endDate: "2026-11-01",
    roundsCount: 1,
    timezone: "Asia/Ho_Chi_Minh",
    primaryColor: "#1d4ed8",
    secondaryColor: "#1e3a8a",
  })) as { tournament: { id: string } };
  const tournamentId = createdTournament.tournament.id;
  const boards: E2eBoard[] = [];
  for (let boardNumber = 1; boardNumber <= boardCount; boardNumber++) {
    const whitePlayerName = `Kỳ Thủ Trắng ${uniqueSuffix}-${boardNumber}`;
    const blackPlayerName = `Kỳ Thủ Đen ${uniqueSuffix}-${boardNumber}`;
    const createdBoard = (await sendE2eMutation(technicalRequest, "POST", `/api/tournaments/${tournamentId}/rounds/1/games`, {
      boardNumber,
      white: { swissManagerPlayerId: `W${uniqueSuffix}${boardNumber}`, fullName: whitePlayerName, clubOrFederation: "", pointsBefore: "0" },
      black: { swissManagerPlayerId: `B${uniqueSuffix}${boardNumber}`, fullName: blackPlayerName, clubOrFederation: "", pointsBefore: "0" },
    })) as { game: { gameId: string } };
    boards.push({ boardNumber, gameId: createdBoard.game.gameId, whitePlayerName, blackPlayerName });
  }
  const resultCodesResponse = await technicalRequest.get(`/api/tournaments/${tournamentId}/result-codes`);
  const { resultCodes } = (await resultCodesResponse.json()) as { resultCodes: { id: string; code: string }[] };
  return {
    tournamentId,
    whitePlayerName: boards[0]?.whitePlayerName ?? "",
    blackPlayerName: boards[0]?.blackPlayerName ?? "",
    boards,
    resultCodeIdByCode: Object.fromEntries(resultCodes.map((resultCode) => [resultCode.code, resultCode.id])),
  };
}

/**
 * Reads a game through the API.
 *
 * @param request - Signed-in request context.
 * @param gameId - Game ID.
 * @returns The game's result status and version.
 */
export async function readGameResult(request: APIRequestContext, gameId: string): Promise<{ status: string; version: number }> {
  const response = await request.get(`/api/games/${gameId}`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { game: { result: { status: string; version: number } } }).game.result;
}

/**
 * Lists the audit actions of a game (TD only).
 *
 * @param technicalRequest - Request context signed in as the TD.
 * @param gameId - Game ID.
 * @returns Action names in time order.
 */
export async function readGameHistoryActions(technicalRequest: APIRequestContext, gameId: string): Promise<string[]> {
  const response = await technicalRequest.get(`/api/games/${gameId}/history`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { history: { action: string }[] }).history.map((historyEntry) => historyEntry.action);
}
