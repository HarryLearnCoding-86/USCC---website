// tests/e2e/tournament-setup.spec.ts
// TD setup through the UI on the desktop viewport (SRS-TOUR-01, 05, SRS-IMP-13): create a tournament, see the
// default result codes, add two boards manually, get a Vietnamese error for a duplicate player, and find a
// board on the round list by diacritic-free name search (SRS-LOOK-02).

import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { vi } from "../../src/i18n/vi";
import { E2E_ACCOUNTS, signInThroughApi } from "./helpers/e2e-api-helpers";

test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "TD setup screens are laptop screens");

test("TD creates a tournament, enters boards manually and finds them on the round list", async ({ page, context }) => {
  await signInThroughApi(context.request, E2E_ACCOUNTS.technical);
  const tournamentName = `Giải UI ${randomUUID().slice(0, 6)}`;

  await page.goto("/tournaments");
  await page.getByLabel(vi.tournaments.nameLabel).fill(tournamentName);
  await page.getByLabel(vi.tournaments.startDateLabel).fill("2026-11-05");
  await page.getByLabel(vi.tournaments.endDateLabel).fill("2026-11-06");
  await page.getByLabel(vi.tournaments.roundsCountLabel).fill("3");
  await page.getByRole("button", { name: vi.tournaments.createButton }).click();

  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: tournamentName })).toBeVisible();
  await expect(page.getByTestId("result-code-row-1-0")).toBeVisible();
  await expect(page.getByTestId("result-code-row-BYE½")).toBeVisible();

  await page.getByRole("link", { name: vi.rounds.roundTitle(1) }).last().click();
  await expect(page.getByRole("heading", { name: vi.manualPairing.pageTitle(1) })).toBeVisible();
  const boardForm = page.locator("form");
  await boardForm.locator('input[name="white-fullName"]').fill("Phạm Quốc Huy");
  await boardForm.locator('input[name="white-swissManagerPlayerId"]').fill("501");
  await boardForm.locator('input[name="black-fullName"]').fill("Trịnh Thu Hà");
  await boardForm.locator('input[name="black-swissManagerPlayerId"]').fill("502");
  await page.getByRole("button", { name: vi.manualPairing.saveBoard }).click();
  await expect(page.getByTestId("manual-board-1")).toContainText("Phạm Quốc Huy");

  // The same player cannot sit at a second board in the round (SRS-IMP-06).
  await boardForm.locator('input[name="white-fullName"]').fill("Phạm Quốc Huy");
  await boardForm.locator('input[name="white-swissManagerPlayerId"]').fill("501");
  await page.getByRole("button", { name: vi.manualPairing.saveBoard }).click();
  await expect(page.getByRole("alert").filter({ hasText: vi.manualPairing.playerOnAnotherBoard(1) })).toBeVisible();

  // A bye: White only.
  await boardForm.locator('input[name="white-fullName"]').fill("Lâm Gia Bảo");
  await boardForm.locator('input[name="white-swissManagerPlayerId"]').fill("503");
  await page.getByRole("button", { name: vi.manualPairing.saveBoard }).click();
  await expect(page.getByTestId("manual-board-2")).toContainText(vi.rounds.bye);

  await page.getByRole("link", { name: vi.rounds.roundTitle(1) }).first().click();
  await page.getByLabel(vi.rounds.searchLabel).fill("trinh thu");
  await expect(page.getByTestId("game-card-1")).toBeVisible();
  await expect(page.getByTestId("game-card-2")).toHaveCount(0);
});
