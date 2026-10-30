// tests/integration/api/result-api-guards.test.ts
// Calls the real Phase 2 route handlers to prove role checks happen on the server (SRS-AUTH-06, SRS-SM-11):
// a recorder can submit and confirm, but gets 403 on approve/edit/reopen/cancel, tournament and pairing changes;
// an idempotent retry of a confirmation applies once (SRS-SYNC-03).

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/database/prisma-client";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-cookie";
import { loginWithPassword } from "@/server/services/authentication-service";
import { POST as submitResult } from "@/app/api/games/[gameId]/result/route";
import { POST as confirmResult } from "@/app/api/games/[gameId]/confirm/route";
import { POST as approveResult } from "@/app/api/games/[gameId]/approve/route";
import { POST as cancelResult } from "@/app/api/games/[gameId]/cancel/route";
import { POST as createTournamentRoute } from "@/app/api/tournaments/route";
import { POST as addBoard } from "@/app/api/tournaments/[tournamentId]/rounds/[roundNumber]/games/route";
import { createFixtureUser, FIXTURE_PASSWORD, wipeTestDatabase } from "../../helpers/test-database";
import { createTournamentFixture, type TournamentFixture } from "../../helpers/tournament-fixtures";

const APP_ORIGIN = "http://localhost:3000";

/**
 * Builds a mutating request with session cookie, origin and idempotency key.
 *
 * @param path - Request path.
 * @param sessionToken - Raw session token.
 * @param body - JSON body.
 * @param idempotencyKey - Idempotency-Key header value.
 * @returns A NextRequest.
 */
function buildMutation(path: string, sessionToken: string, body: unknown, idempotencyKey: string): NextRequest {
  return new NextRequest(`${APP_ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP_ORIGIN, cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`, "idempotency-key": idempotencyKey },
    body: JSON.stringify(body),
  });
}

/**
 * Signs a fixture user in.
 *
 * @param username - Fixture username.
 * @returns Raw session token.
 */
async function signIn(username: string): Promise<string> {
  const loginOutcome = await loginWithPassword({ username, password: FIXTURE_PASSWORD }, { userAgent: null, ipAddress: null });
  if (loginOutcome.outcome !== "SIGNED_IN") throw new Error("fixture login failed");
  return loginOutcome.sessionToken;
}

describe("Phase 2 API role checks", () => {
  let fixture: TournamentFixture;
  let recorderToken: string;
  let technicalToken: string;

  beforeEach(async () => {
    await wipeTestDatabase();
    await createFixtureUser("recorder_api2", "RECORDER");
    await createFixtureUser("td_api2", "TECHNICAL");
    recorderToken = await signIn("recorder_api2");
    technicalToken = await signIn("td_api2");
    fixture = await createTournamentFixture();
  });

  it("lets a recorder submit and confirm, and applies a retried confirmation once", async () => {
    const gameId = fixture.twoPlayerGame.gameId;
    const gameContext = { params: Promise.resolve({ gameId }) };
    const submitResponse = await submitResult(
      buildMutation(`/api/games/${gameId}/result`, recorderToken, { resultCodeId: fixture.resultCodeIdByCode["1-0"], version: 0 }, "submit-1"),
      gameContext,
    );
    expect(submitResponse.status).toBe(200);

    const confirmRequest = () => buildMutation(`/api/games/${gameId}/confirm`, recorderToken, { side: "WHITE", decision: "CONFIRM", version: 1 }, "confirm-white-1");
    const firstConfirm = await confirmResult(confirmRequest(), gameContext);
    const retriedConfirm = await confirmResult(confirmRequest(), gameContext);
    expect(firstConfirm.status).toBe(200);
    expect(retriedConfirm.status).toBe(200);
    expect(await retriedConfirm.json()).toEqual(await firstConfirm.json());
    expect(await prisma.resultEvent.count({ where: { action: "CONFIRM_WHITE" } })).toBe(1);
  });

  it("returns 403 to a recorder for TD actions, tournament creation and pairing entry", async () => {
    const gameId = fixture.twoPlayerGame.gameId;
    const gameContext = { params: Promise.resolve({ gameId }) };
    const reasonBody = { reason: "Lý do đủ dài", version: 0 };
    expect((await approveResult(buildMutation(`/api/games/${gameId}/approve`, recorderToken, reasonBody, "k1"), gameContext)).status).toBe(403);
    expect((await cancelResult(buildMutation(`/api/games/${gameId}/cancel`, recorderToken, reasonBody, "k2"), gameContext)).status).toBe(403);
    expect((await createTournamentRoute(buildMutation("/api/tournaments", recorderToken, {}, "k3"), { params: Promise.resolve({}) })).status).toBe(403);
    const roundContext = { params: Promise.resolve({ tournamentId: fixture.tournamentId, roundNumber: "1" }) };
    expect((await addBoard(buildMutation(`/api/tournaments/${fixture.tournamentId}/rounds/1/games`, recorderToken, {}, "k4"), roundContext)).status).toBe(403);
  });

  it("returns 409 with the Vietnamese reload message for a stale version through the API", async () => {
    const gameId = fixture.twoPlayerGame.gameId;
    const gameContext = { params: Promise.resolve({ gameId }) };
    const staleResponse = await confirmResult(
      buildMutation(`/api/games/${gameId}/confirm`, technicalToken, { side: "WHITE", decision: "CONFIRM", version: 7 }, "stale-1"),
      gameContext,
    );
    expect(staleResponse.status).toBe(409);
    expect(await staleResponse.json()).toMatchObject({ code: "VERSION_CONFLICT", messageVi: "Kết quả đã thay đổi. Vui lòng tải lại." });
  });
});
