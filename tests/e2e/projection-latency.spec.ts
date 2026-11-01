// tests/e2e/projection-latency.spec.ts
// Phase 3 acceptance (AGENT_PROMPT.md §3.6, SRS-PROJ-04, NFR-01): an OFFICIAL result appears on the projection
// screen within 5 s without reload. 20 iterations, as NFR-01 specifies; every iteration must be under 5 s, which
// is stricter than the 95th-percentile requirement. Also checks that PENDING and DISPUTED never appear (FR-06)
// and that a cancelled result disappears. Runs at 1920×1080.

import { expect, test, type APIRequestContext } from "@playwright/test";
import { vi } from "../../src/i18n/vi";
import { createE2eTournament, E2E_ACCOUNTS, sendE2eMutation, signInThroughApi, type E2eBoard } from "./helpers/e2e-api-helpers";

const ITERATION_COUNT = 20;
const BOARD_COUNT = 8;
const MAXIMUM_LATENCY_MILLISECONDS = 5_000;

test("official results reach the projection screen within 5 s (20 iterations)", async ({ browser, page, context }) => {
  test.setTimeout(240_000);
  await signInThroughApi(context.request, E2E_ACCOUNTS.technical);
  const tournament = await createE2eTournament(context.request, BOARD_COUNT);
  const recorderContext = await browser.newContext();
  await signInThroughApi(recorderContext.request, E2E_ACCOUNTS.recorder);
  const recorderRequest: APIRequestContext = recorderContext.request;
  const whiteWinCodeId = tournament.resultCodeIdByCode["1-0"] as string;

  await page.goto(`/tournaments/${tournament.tournamentId}/projection?round=1`);
  const projectionScreen = page.getByTestId("projection-screen");
  await expect(projectionScreen).toHaveAttribute("data-connection-state", "CONNECTED");
  await expect(page.getByText(vi.projection.roundTitle(1), { exact: true })).toBeVisible();

  const versionByGameId = new Map<string, number>();
  const latenciesMilliseconds: number[] = [];

  for (let iterationIndex = 0; iterationIndex < ITERATION_COUNT; iterationIndex++) {
    const board = tournament.boards[iterationIndex % BOARD_COUNT] as E2eBoard;
    const resultCell = page.getByTestId(`projection-result-${board.boardNumber}`);
    let version = versionByGameId.get(board.gameId) ?? 0;

    if (version > 0) {
      // Board already official from an earlier iteration: the TD cancels it, and it must disappear.
      await sendE2eMutation(context.request, "POST", `/api/games/${board.gameId}/cancel`, { reason: "Kiểm thử độ trễ", version });
      version += 1;
      await expect(resultCell).toHaveText("");
    }

    await sendE2eMutation(recorderRequest, "POST", `/api/games/${board.gameId}/result`, { resultCodeId: whiteWinCodeId, version });
    await sendE2eMutation(recorderRequest, "POST", `/api/games/${board.gameId}/confirm`, { side: "WHITE", decision: "CONFIRM", version: version + 1 });
    // FR-06: a PENDING result is never projected.
    await expect(resultCell).toHaveText("");

    await sendE2eMutation(recorderRequest, "POST", `/api/games/${board.gameId}/confirm`, { side: "BLACK", decision: "CONFIRM", version: version + 2 });
    const officialAt = Date.now();
    await expect(resultCell).toContainText("1 – 0", { timeout: MAXIMUM_LATENCY_MILLISECONDS });
    latenciesMilliseconds.push(Date.now() - officialAt);
    versionByGameId.set(board.gameId, version + 3);
  }

  const sortedLatencies = [...latenciesMilliseconds].sort((first, second) => first - second);
  const percentile95 = sortedLatencies[Math.ceil(0.95 * sortedLatencies.length) - 1] ?? 0;
  test.info().annotations.push({ type: "projection-latency", description: `p95 ${percentile95} ms; all ${sortedLatencies.join(", ")} ms` });
  console.warn(`Projection latency over ${ITERATION_COUNT} iterations: p95 ${percentile95} ms, max ${sortedLatencies.at(-1)} ms`);
  expect(percentile95).toBeLessThan(MAXIMUM_LATENCY_MILLISECONDS);
  await expect(page.getByTestId("projection-last-sync")).toContainText(vi.projection.lastSync("").trim());
  await recorderContext.close();
});

test("a disputed result never reaches the projection", async ({ page, context }) => {
  await signInThroughApi(context.request, E2E_ACCOUNTS.technical);
  const tournament = await createE2eTournament(context.request, 1);
  const board = tournament.boards[0] as E2eBoard;
  await page.goto(`/tournaments/${tournament.tournamentId}/projection`);
  await expect(page.getByTestId("projection-screen")).toHaveAttribute("data-connection-state", "CONNECTED");

  await sendE2eMutation(context.request, "POST", `/api/games/${board.gameId}/result`, { resultCodeId: tournament.resultCodeIdByCode["1-0"], version: 0 });
  await sendE2eMutation(context.request, "POST", `/api/games/${board.gameId}/confirm`, { side: "BLACK", decision: "REJECT", version: 1 });
  // Give the live update time to arrive, then check the cell is still empty.
  await page.waitForTimeout(1_500);
  await expect(page.getByTestId(`projection-result-${board.boardNumber}`)).toHaveText("");
  await expect(page.getByTestId(`projection-row-${board.boardNumber}`)).toContainText(board.whitePlayerName);

});

test("the projection shows an offline banner, keeps its data and reconnects (SRS-PROJ-05, SRS-SYNC-05)", async ({ page, context }) => {
  await signInThroughApi(context.request, E2E_ACCOUNTS.technical);
  const tournament = await createE2eTournament(context.request, 1);
  const board = tournament.boards[0] as E2eBoard;
  // Simulate the venue network dropping the live channel: the event stream cannot connect.
  const eventStreamPattern = "**/api/tournaments/*/events";
  await page.route(eventStreamPattern, (route) => route.abort("internetdisconnected"));
  await page.goto(`/tournaments/${tournament.tournamentId}/projection`);
  await expect(page.getByTestId("projection-offline-banner")).toBeVisible();
  await expect(page.getByTestId(`projection-row-${board.boardNumber}`)).toContainText(board.whitePlayerName);

  // While disconnected, the result becomes official; after reconnecting the screen reloads full state.
  await sendE2eMutation(context.request, "POST", `/api/games/${board.gameId}/result`, { resultCodeId: tournament.resultCodeIdByCode["0-1"], version: 0 });
  await sendE2eMutation(context.request, "POST", `/api/games/${board.gameId}/confirm`, { side: "WHITE", decision: "CONFIRM", version: 1 });
  await sendE2eMutation(context.request, "POST", `/api/games/${board.gameId}/confirm`, { side: "BLACK", decision: "CONFIRM", version: 2 });
  await page.unroute(eventStreamPattern);
  // Backoff is 1 s, 2 s, 4 s … so reconnecting can take up to the next scheduled attempt.
  await expect(page.getByTestId("projection-screen")).toHaveAttribute("data-connection-state", "CONNECTED", { timeout: 40_000 });
  await expect(page.getByTestId("projection-offline-banner")).toHaveCount(0);
  await expect(page.getByTestId(`projection-result-${board.boardNumber}`)).toContainText("0 – 1");
});
