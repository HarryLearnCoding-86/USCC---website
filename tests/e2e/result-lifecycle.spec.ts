// tests/e2e/result-lifecycle.spec.ts
// Phase 2 acceptance flows (AGENT_PROMPT.md §4 Phase 2, PRD acceptance criteria), run on mobile and desktop:
//   1. recorder enters a result → White confirms → Black confirms → OFFICIAL;
//   2. Black rejects → DISPUTED → the TD approves with a reason in the console, and the history shows it.

import { expect, test, type Browser, type Page } from "@playwright/test";
import { vi } from "../../src/i18n/vi";
import { createE2eTournament, E2E_ACCOUNTS, signInThroughApi, type E2eTournament } from "./helpers/e2e-api-helpers";

/**
 * Creates a fresh tournament as the TD and returns a page signed in as the recorder on its round list.
 *
 * @param browser - Playwright browser.
 * @param recorderPage - The test's page (project viewport), to be signed in as recorder.
 * @returns The tournament data.
 */
async function prepareRecorderOnRoundList(browser: Browser, recorderPage: Page): Promise<E2eTournament> {
  const technicalContext = await browser.newContext();
  await signInThroughApi(technicalContext.request, E2E_ACCOUNTS.technical);
  const tournament = await createE2eTournament(technicalContext.request);
  await technicalContext.close();

  await recorderPage.goto("/login");
  await recorderPage.getByLabel(vi.auth.usernameLabel).fill(E2E_ACCOUNTS.recorder.username);
  await recorderPage.getByLabel(vi.auth.passwordLabel).fill(E2E_ACCOUNTS.recorder.password);
  await recorderPage.getByRole("button", { name: vi.auth.loginButton }).click();
  await expect(recorderPage.getByTestId("signed-in-user")).toBeVisible();
  await recorderPage.goto(`/tournaments/${tournament.tournamentId}/rounds/1`);
  return tournament;
}

/**
 * Taps board 1, picks "Trắng thắng", checks the review screen and sends it to the players.
 * Two taps from the round list reach the result buttons (SRS-LOOK-04: ≤ 3).
 *
 * @param page - Recorder page on the round list.
 * @param tournament - Tournament with player names.
 */
async function enterWhiteWinAndSubmit(page: Page, tournament: E2eTournament) {
  await page.getByTestId("game-card-1").click();
  await page.getByRole("button", { name: vi.defaultResultCodeLabels.whiteWins }).click();
  await expect(page.getByRole("heading", { name: vi.record.reviewTitle })).toBeVisible();
  await expect(page.getByTestId("review-score")).toHaveText("1 – 0");
  await expect(page.getByText(tournament.whitePlayerName)).toBeVisible();
  await page.getByRole("button", { name: vi.record.submitToPlayers }).click();
}

test("recorder: enter result → White confirms → Black confirms → OFFICIAL", async ({ browser, page }) => {
  const tournament = await prepareRecorderOnRoundList(browser, page);
  await enterWhiteWinAndSubmit(page, tournament);

  const whiteStep = page.getByTestId("confirmation-step-WHITE");
  await expect(whiteStep).toContainText(tournament.whitePlayerName);
  await expect(whiteStep).not.toContainText(tournament.blackPlayerName);
  await expect(whiteStep).toContainText(vi.record.reminderCheckPlayer);
  const whiteConfirmButton = whiteStep.getByRole("button", { name: vi.record.confirmButton });
  const confirmButtonBox = await whiteConfirmButton.boundingBox();
  expect(confirmButtonBox?.height ?? 0).toBeGreaterThanOrEqual(56);
  await whiteConfirmButton.click();
  await expect(whiteStep.getByText(vi.record.stepConfirmed)).toBeVisible();
  // SRS-CONF-05: the step is locked after the first tap.
  await expect(whiteConfirmButton).toBeDisabled();
  await expect(whiteStep.getByRole("button", { name: vi.record.rejectButton })).toBeDisabled();

  await page.getByRole("button", { name: vi.record.continueToBlack }).click();
  const blackStep = page.getByTestId("confirmation-step-BLACK");
  await expect(blackStep).toContainText(tournament.blackPlayerName);
  await blackStep.getByRole("button", { name: vi.record.confirmButton }).click();

  const finalScreen = page.getByTestId("final-screen");
  await expect(finalScreen).toContainText(vi.record.finalStatus(vi.resultStatus.OFFICIAL));
  await expect(finalScreen).toContainText(vi.record.finalOfficialByPlayers);

  await finalScreen.getByRole("link", { name: vi.record.backToList }).click();
  await expect(page.getByTestId("game-card-1").getByTestId("result-status")).toHaveText(vi.resultStatus.OFFICIAL);
});

test("recorder: Black rejects → DISPUTED → TD approves with reason", async ({ browser, page }) => {
  const tournament = await prepareRecorderOnRoundList(browser, page);
  await enterWhiteWinAndSubmit(page, tournament);
  await page.getByTestId("confirmation-step-WHITE").getByRole("button", { name: vi.record.confirmButton }).click();
  await page.getByRole("button", { name: vi.record.continueToBlack }).click();
  await page.getByTestId("confirmation-step-BLACK").getByRole("button", { name: vi.record.rejectButton }).click();

  const finalScreen = page.getByTestId("final-screen");
  await expect(finalScreen).toContainText(vi.record.finalStatus(vi.resultStatus.DISPUTED));
  await expect(finalScreen).toContainText(vi.record.finalDisputed);

  // The TD resolves the dispute in the console on a laptop.
  const technicalContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await signInThroughApi(technicalContext.request, E2E_ACCOUNTS.technical);
  const technicalPage = await technicalContext.newPage();
  await technicalPage.goto(`/tournaments/${tournament.tournamentId}/console`);
  const disputedItem = technicalPage.getByTestId("disputed-1-1");
  await expect(disputedItem).toContainText(vi.console.disputedBy(vi.rounds.black));
  await disputedItem.getByRole("button", { name: vi.console.selectGame }).click();

  const actionPanel = technicalPage.getByTestId("game-action-panel");
  await actionPanel.getByLabel(vi.console.reasonLabel).fill("ok");
  await actionPanel.getByRole("button", { name: vi.console.approveButton }).click();
  await expect(actionPanel.getByRole("alert").filter({ hasText: vi.resultErrors.reasonTooShort(5) })).toBeVisible();

  await actionPanel.getByLabel(vi.console.reasonLabel).fill("Trọng tài đã xem lại biên bản ván đấu");
  await actionPanel.getByRole("button", { name: vi.console.approveButton }).click();
  await expect(technicalPage.getByTestId("status-count-OFFICIAL")).toContainText("1");
  await expect(technicalPage.getByTestId("disputed-1-1")).toHaveCount(0);

  await technicalPage.getByTestId("console-game-1").getByRole("button", { name: vi.console.selectGame }).click();
  const history = technicalPage.getByTestId("game-history");
  await expect(history).toContainText(vi.console.eventActions.REJECT_BLACK as string);
  await expect(history).toContainText(vi.console.historyReason("Trọng tài đã xem lại biên bản ván đấu"));
  await technicalContext.close();
});
