// tests/e2e/tournament-list.spec.ts
// The home page tournament list: searching without diacritics, choosing a sort order through the form, and the
// "no matches" message. Runs on phone and laptop sizes, since recorders open this page on their phones.

import { expect, test } from "@playwright/test";
import { vi } from "../../src/i18n/vi";
import { E2E_ACCOUNTS, signInThroughApi } from "./helpers/e2e-api-helpers";

test("recorder searches and sorts the tournament list", async ({ page, context }) => {
  await signInThroughApi(context.request, E2E_ACCOUNTS.recorder);
  await page.goto("/");

  await page.getByLabel(vi.tournamentList.searchLabel).fill("giai demo uscc");
  await page.getByLabel(vi.tournamentList.sortLabel).selectOption("wins-desc");
  await page.getByRole("button", { name: vi.tournamentList.applyButton }).click();

  await expect(page).toHaveURL(/q=giai\+demo\+uscc/);
  await expect(page).toHaveURL(/sort=wins-desc/);
  await expect(page.getByTestId("tournament-list").getByRole("heading", { name: "Giải Demo USCC 2026" })).toBeVisible();
  await expect(page.getByTestId("tournament-list-pager")).toContainText(vi.tournamentList.shownRange(1, 1, 1));

  await page.getByLabel(vi.tournamentList.searchLabel).fill("không tồn tại xyz");
  await page.getByRole("button", { name: vi.tournamentList.applyButton }).click();
  await expect(page.getByText(vi.tournamentList.noMatches)).toBeVisible();
});
