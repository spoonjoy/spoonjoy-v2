// A household shared by two people, as scratch index 10 (AGENTS.md's scratch index table): its base
// account makes a household and an invite link, and its desktop twin opens the link in a second
// browser and joins. Both see each other in People after a reload. The owner then makes the twin
// view-only and removes them, and each change shows on the twin's next load. Desktop only: the two accounts are the two people, so an iPhone run at the same
// time would share them. The household's name carries a timestamp, so each run's household is its
// own. The households flag is on in QA.
import type { Page, TestInfo } from "@playwright/test";
import { test, expect, appendConsoleIssues, assertNoConsoleIssues, watchConsole } from "./support/journey";
import { waitForHydrationOnLoad } from "./support/app-ready";
import { pathUrl, waitForHydration } from "./support/navigation";
import { scratch, scratchDesktop, scratchDesktopStorageStatePath, scratchStorageStatePath } from "./support/personas";

const SCRATCH_INDEX = 10;

const HOUSEHOLD_URL = /\/households\/[0-9a-f-]{36}$/;

async function attachScreenshot(testInfo: TestInfo, page: Page, name: string) {
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true, animations: "disabled" }), contentType: "image/png" });
}

/** The page's next successful POST to the household, which is when a change made on it is saved. */
function saved(page: Page, householdPath: string) {
  return page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname.startsWith(householdPath) && response.ok(),
  );
}

function people(page: Page) {
  return page.getByRole("list", { name: "People" });
}

test.describe("Households", () => {
  // The owner: scratch 10's base account.
  test.use({ storageState: scratchStorageStatePath(SCRATCH_INDEX) });

  test("an invite link joins a second person, and both see the household after a reload @mutates", async ({
    page,
    browser,
    verifyAfterReload,
    expectAccessible,
  }, testInfo) => {
    const owner = scratch(SCRATCH_INDEX);
    const joiner = scratchDesktop(SCRATCH_INDEX);
    const name = `Household ${Date.now().toString(36)}`;

    // The owner makes a household and lands on it.
    await page.goto("/households");
    await waitForHydration(page);
    await expect(page.getByRole("heading", { level: 1, name: "Cook together", exact: true })).toBeVisible();
    await page.getByLabel("Household name").fill(name);
    await page.getByRole("button", { name: "Create household", exact: true }).click();
    await expect(page).toHaveURL(HOUSEHOLD_URL);
    const householdPath = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
    await expect(people(page).getByText(`${owner.username} (you)`, { exact: true })).toBeVisible();

    // The top bar's actions link the cook's households, marked as the current page; the page links
    // stay out of the Menu button at this width.
    const householdsLink = page.getByRole("banner").getByRole("link", { name: "Households", exact: true });
    await expect(page.getByRole("banner").getByRole("button", { name: "Menu", exact: true })).toBeHidden();
    await expect(householdsLink).toHaveAttribute("href", "/households");
    await expect(householdsLink).toHaveAttribute("aria-current", "page");
    await testInfo.attach("households-nav-link", {
      body: await page.locator('[data-ouro="navbar"]').screenshot({ animations: "disabled" }),
      contentType: "image/png",
    });

    // An invite link for a member.
    await page.getByRole("button", { name: "Make invite link", exact: true }).click();
    const linkField = page.getByLabel("Invite link");
    await expect(linkField).toHaveValue(/\/join\/[A-Za-z0-9_-]{43}$/);
    const inviteUrl = await linkField.inputValue();
    await expectAccessible();
    await attachScreenshot(testInfo, page, "owner-invite-link");

    // The joiner opens the link in their own browser and joins.
    const joinerContext = await browser.newContext({ storageState: scratchDesktopStorageStatePath(SCRATCH_INDEX) });
    const joinerPage = await joinerContext.newPage();
    waitForHydrationOnLoad(joinerPage);
    const joinerConsole = watchConsole(joinerPage);
    try {
      await joinerPage.goto(new URL(inviteUrl).pathname);
      await waitForHydration(joinerPage);
      await expect(joinerPage.getByRole("heading", { level: 1, name: `Join ${name}`, exact: true })).toBeVisible();
      await attachScreenshot(testInfo, joinerPage, "joiner-invite");
      await joinerPage.getByRole("button", { name: "Join household", exact: true }).click();
      await expect(joinerPage).toHaveURL(pathUrl(householdPath));

      // After a reload the joiner is in, as a member, beside the owner.
      await joinerPage.reload({ waitUntil: "load" });
      await expect(joinerPage.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
      await expect(people(joinerPage).getByText(`${joiner.username} (you)`, { exact: true })).toBeVisible();
      await expect(people(joinerPage).getByText(owner.username, { exact: true })).toBeVisible();
      await expect(joinerPage.getByRole("button", { name: "Make invite link", exact: true })).toHaveCount(0);
      await attachScreenshot(testInfo, joinerPage, "joiner-household");

      // The owner sees them too, after a reload.
      await verifyAfterReload(async () => {
        await expect(people(page).getByText(joiner.username, { exact: true })).toBeVisible();
        await expect(people(page).getByText("Member", { exact: true })).toBeVisible();
      });
      await attachScreenshot(testInfo, page, "owner-household");

      // The owner makes the joiner view-only, and the joiner sees it on their next load.
      await page.getByRole("button", { name: `Actions for ${joiner.username}`, exact: true }).click();
      // Reload only once the change is saved: a reload that wins the race against the POST would drop it.
      await Promise.all([saved(page, householdPath), page.getByRole("menuitemradio", { name: "View-only", exact: true }).click()]);
      // The row shows the role the server confirmed, without a reload.
      await expect(people(page).getByText("View-only", { exact: true })).toBeVisible();
      await expect(people(page).getByRole("status", { name: "Saving" })).toHaveCount(0);
      await verifyAfterReload(async () => {
        await expect(people(page).getByText("View-only", { exact: true })).toBeVisible();
      });
      await joinerPage.reload({ waitUntil: "load" });
      await expect(people(joinerPage).getByText("View-only", { exact: true })).toBeVisible();

      // The owner removes the joiner, after confirming, and the household is gone from the joiner's list.
      await page.getByRole("button", { name: `Actions for ${joiner.username}`, exact: true }).click();
      await page.getByRole("menuitem", { name: "Remove from household", exact: true }).click();
      const confirm = page.getByRole("alertdialog", { name: `Remove ${joiner.username}?` });
      await expectAccessible();
      await attachScreenshot(testInfo, page, "owner-remove-dialog");
      await Promise.all([saved(page, householdPath), confirm.getByRole("button", { name: "Remove", exact: true }).click()]);
      await expect(people(page).getByText(joiner.username, { exact: true })).toHaveCount(0);
      await verifyAfterReload(async () => {
        await expect(people(page).getByText(joiner.username, { exact: true })).toHaveCount(0);
      });
      await joinerPage.goto("/households");
      await expect(joinerPage.getByRole("link", { name })).toHaveCount(0);
    } catch (error) {
      throw appendConsoleIssues(error, joinerConsole.issues);
    } finally {
      joinerConsole.dispose();
      await joinerContext.close();
    }
    assertNoConsoleIssues(joinerConsole.issues);

    // The owner's list still has it.
    await page.goto("/households");
    await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
  });
});
