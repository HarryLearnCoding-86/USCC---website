// tests/e2e/offline-sync.spec.ts
// Phase 3 acceptance (AGENT_PROMPT.md §3.6, SRS-SYNC-01..03, NFR-05) on the mobile viewport:
//   1. With result requests failing, the recorder submits and both players confirm; the actions queue in IndexedDB,
//      the badge shows "Chưa đồng bộ (N)", the queue survives a page reload, and once the network is back each
//      action is applied exactly once (three audit events, version 3, OFFICIAL).
//   2. A request that reaches the server but whose response is lost is retried with the same Idempotency-Key and
//      applied once.

import { expect, test, type Page } from "@playwright/test";
import { vi } from "../../src/i18n/vi";
import {
  createE2eTournament,
  E2E_ACCOUNTS,
  readGameHistoryActions,
  readGameResult,
  signInThroughApi,
  type E2eBoard,
} from "./helpers/e2e-api-helpers";

/** Result-action requests the recorder phone sends. */
const RESULT_ACTION_PATTERN = /\/api\/games\/[^/]+\/(result|confirm)$/;

/**
 * Signs the page in as the recorder through the login form.
 *
 * @param page - Page to sign in.
 */
async function signInAsRecorder(page: Page) {
  await page.goto("/login");
  await page.getByLabel(vi.auth.usernameLabel).fill(E2E_ACCOUNTS.recorder.username);
  await page.getByLabel(vi.auth.passwordLabel).fill(E2E_ACCOUNTS.recorder.password);
  await page.getByRole("button", { name: vi.auth.loginButton }).click();
  await expect(page.getByTestId("signed-in-user")).toBeVisible();
}

test("offline actions queue, survive a reload, and sync exactly once when the network returns", async ({ page, browser }) => {
  const technicalContext = await browser.newContext();
  await signInThroughApi(technicalContext.request, E2E_ACCOUNTS.technical);
  const tournament = await createE2eTournament(technicalContext.request, 1);
  const board = tournament.boards[0] as E2eBoard;

  await signInAsRecorder(page);
  await page.goto(`/record/${board.gameId}`);
  await expect(page.getByRole("heading", { name: vi.record.chooseResult })).toBeVisible();

  // The venue network drops: every result action fails before reaching the server.
  await page.route(RESULT_ACTION_PATTERN, (route) => route.abort("internetdisconnected"));
  await page.getByRole("button", { name: vi.defaultResultCodeLabels.whiteWins }).click();
  await page.getByRole("button", { name: vi.record.submitToPlayers }).click();
  await expect(page.getByTestId("queued-notice")).toBeVisible();
  await expect(page.getByTestId("offline-sync-badge")).toHaveText(vi.offlineQueue.unsyncedBadge(1));

  // The flow continues on the predicted state: White, then Black confirm while still offline.
  await page.getByTestId("confirmation-step-WHITE").getByRole("button", { name: vi.record.confirmButton }).click();
  await expect(page.getByTestId("confirmation-step-WHITE").getByText(vi.record.stepConfirmed)).toBeVisible();
  await page.getByRole("button", { name: vi.record.continueToBlack }).click();
  await page.getByTestId("confirmation-step-BLACK").getByRole("button", { name: vi.record.confirmButton }).click();
  await expect(page.getByTestId("final-screen")).toContainText(vi.record.finalStatus(vi.resultStatus.OFFICIAL));
  await expect(page.getByTestId("offline-sync-badge")).toHaveText(vi.offlineQueue.unsyncedBadge(3));
  expect(await readGameResult(technicalContext.request, board.gameId)).toMatchObject({ status: "NONE", version: 0 });

  // NFR-05: the queue survives a page reload.
  await page.reload();
  await expect(page.getByTestId("offline-sync-badge")).toHaveText(vi.offlineQueue.unsyncedBadge(3));

  // The network returns; the arbiter taps the badge to send now instead of waiting for the backoff timer.
  await page.unroute(RESULT_ACTION_PATTERN);
  await page.getByTestId("offline-sync-badge").click();
  await expect(page.getByTestId("offline-sync-badge")).toHaveCount(0);

  // Exactly once: three actions, three audit events, version 3.
  expect(await readGameResult(technicalContext.request, board.gameId)).toMatchObject({ status: "OFFICIAL", version: 3 });
  expect(await readGameHistoryActions(technicalContext.request, board.gameId)).toEqual(["SUBMIT_RESULT", "CONFIRM_WHITE", "CONFIRM_BLACK"]);
  await technicalContext.close();
});

test("a lost response is retried with the same key and applied exactly once (SRS-SYNC-03)", async ({ page, browser }) => {
  const technicalContext = await browser.newContext();
  await signInThroughApi(technicalContext.request, E2E_ACCOUNTS.technical);
  const tournament = await createE2eTournament(technicalContext.request, 1);
  const board = tournament.boards[0] as E2eBoard;

  await signInAsRecorder(page);
  await page.goto(`/record/${board.gameId}`);
  await expect(page.getByRole("heading", { name: vi.record.chooseResult })).toBeVisible();

  // The submit reaches the server and is applied, but the phone never receives the response.
  const sentIdempotencyKeys: string[] = [];
  await page.route(RESULT_ACTION_PATTERN, async (route) => {
    sentIdempotencyKeys.push(route.request().headers()["idempotency-key"] ?? "");
    await route.fetch();
    await route.abort("connectionreset");
  });
  await page.getByRole("button", { name: vi.defaultResultCodeLabels.whiteWins }).click();
  await page.getByRole("button", { name: vi.record.submitToPlayers }).click();
  await expect(page.getByTestId("offline-sync-badge")).toHaveText(vi.offlineQueue.unsyncedBadge(1));
  expect(await readGameResult(technicalContext.request, board.gameId)).toMatchObject({ status: "PENDING", version: 1 });

  await page.unroute(RESULT_ACTION_PATTERN);
  const replayRequest = page.waitForRequest((request) => RESULT_ACTION_PATTERN.test(new URL(request.url()).pathname));
  await page.getByTestId("offline-sync-badge").click();
  expect((await replayRequest).headers()["idempotency-key"]).toBe(sentIdempotencyKeys[0]);
  await expect(page.getByTestId("offline-sync-badge")).toHaveCount(0);

  // The replay returned the stored response: still one submit, version 1, and the flow continues normally.
  expect(await readGameHistoryActions(technicalContext.request, board.gameId)).toEqual(["SUBMIT_RESULT"]);
  await page.getByTestId("confirmation-step-WHITE").getByRole("button", { name: vi.record.confirmButton }).click();
  await expect(page.getByTestId("confirmation-step-WHITE").getByText(vi.record.stepConfirmed)).toBeVisible();
  expect(await readGameResult(technicalContext.request, board.gameId)).toMatchObject({ status: "PENDING", version: 2 });
  await technicalContext.close();
});
