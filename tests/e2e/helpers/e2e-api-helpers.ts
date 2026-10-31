// tests/e2e/helpers/e2e-api-helpers.ts
// Helpers for end-to-end tests: sign in through the API and build a fresh tournament with boards as the TD,
// so each test owns its data and can be re-run against the seeded dev database without cleanup.
// Player names are fictional (CLAUDE.md §2).

import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext } from "@playwright/test";

/** Demo credentials from the seed (overridable with SEED_* env vars). */
export const E2E_ACCOUNTS = {
  technical: { username: process.env.SEED_TD_USERNAME ?? "td_demo", password: process.env.SEED_TD_PASSWORD ?? "TdDemo-2026!" },
  recorder: { username: process.env.SEED_RECORDER_USERNAME ?? "recorder_demo", password: process.env.SEED_RECORDER_PASSWORD ?? "RecDemo-2026!" },
};

const E2E_ORIGIN = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Sends a JSON mutation the way the app does: same Origin, fresh Idempotency-Key.
 *
 * @param request - Playwright request context (carries the session cookie).
 * @param httpMethod - POST, PUT, PATCH or DELETE.
 * @param path - API path.
 * @param requestBody - JSON body.
 * @returns Parsed JSON body; fails the test on a non-2xx response.
 */
export async function sendE2eMutation(request: APIRequestContext, httpMethod: "POST" | "PUT" | "PATCH" | "DELETE", path: string, requestBody: unknown) {
  const response = await request.fetch(path, {
    method: httpMethod,
    headers: { origin: E2E_ORIGIN, "content-type": "application/json", "idempotency-key": randomUUID() },
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

/** IDs and names of the tournament built for a test. */
export interface E2eTournament {
  tournamentId: string;
  whitePlayerName: string;
  blackPlayerName: string;
}

/**
 * Creates a one-round tournament with board 1 through the TD API.
 *
 * @param technicalRequest - Request context signed in as the TD.
 * @returns Tournament ID and the player names on board 1.
 */
export async function createE2eTournament(technicalRequest: APIRequestContext): Promise<E2eTournament> {
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
  const whitePlayerName = `Kỳ Thủ Trắng ${uniqueSuffix}`;
  const blackPlayerName = `Kỳ Thủ Đen ${uniqueSuffix}`;
  await sendE2eMutation(technicalRequest, "POST", `/api/tournaments/${tournamentId}/rounds/1/games`, {
    boardNumber: 1,
    white: { swissManagerPlayerId: `W${uniqueSuffix}`, fullName: whitePlayerName, clubOrFederation: "", pointsBefore: "0" },
    black: { swissManagerPlayerId: `B${uniqueSuffix}`, fullName: blackPlayerName, clubOrFederation: "", pointsBefore: "0" },
  });
  return { tournamentId, whitePlayerName, blackPlayerName };
}
