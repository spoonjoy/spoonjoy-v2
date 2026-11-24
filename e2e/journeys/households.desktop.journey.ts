// A household shared by two people, as scratch index 10 (AGENTS.md's scratch index table): its base
// account makes a household and an invite link, and its desktop twin opens the link in a second
// browser and joins. Both see each other in People after a reload; the owner renames the household and the
// twin sees the new name. They share a shopping list: the twin adds to
// it and the owner checks it off. The owner then makes the twin view-only and removes them, and each change
// shows on the twin's next load: view-only, they still read the list but can't change it. Desktop only: the two accounts are the two people, so an iPhone run at the same
// time would share them. The household's name carries a run tag, so each run's household is its
// own. The households flag is on in QA.
import type { Locator, Page, TestInfo } from "@playwright/test";
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

async function attachLocatorScreenshot(testInfo: TestInfo, locator: Locator, name: string) {
  await testInfo.attach(name, { body: await locator.screenshot({ animations: "disabled" }), contentType: "image/png" });
}

/**
 * Screenshots one element in the middle of the screen, so the sticky top bar can't cover any of it (a full-page capture
 * draws that bar wherever the page was scrolled to).
 */
async function attachElementScreenshot(testInfo: TestInfo, locator: Locator, name: string) {
  await locator.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await testInfo.attach(name, { body: await locator.screenshot({ animations: "disabled" }), contentType: "image/png" });
}

/** Opens `name` from the Kitchen's Cook together list at the given size, then checks it after a reload. */
async function openFromKitchen(
  page: Page,
  testInfo: TestInfo,
  { name, householdPath, width, height, shot }: { name: string; householdPath: string; width: number; height: number; shot: string },
) {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await waitForHydration(page);
  const cookTogether = page.getByRole("region", { name: "Cook together" });
  const household = cookTogether.getByRole("list", { name: "Your households" }).getByRole("link", { name, exact: true });
  await expect(household).toBeVisible();
  await expect(cookTogether.getByRole("link", { name: "Start a household", exact: true })).toHaveCount(0);
  await attachLocatorScreenshot(testInfo, cookTogether, shot);
  // The whole first screen, so the shot shows where the section sits under the Kitchen's action row.
  await expect(cookTogether).toBeInViewport();
  await testInfo.attach(`${shot}-page`, { body: await page.screenshot({ animations: "disabled" }), contentType: "image/png" });
  await household.click();
  await expect(page).toHaveURL(pathUrl(householdPath));
  await page.reload({ waitUntil: "load" });
  await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
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
    // Two people and some 30 reloads and page loads: about 40 s on a quiet QA Worker, and 60 s, the journey default,
    // when the Worker is busy (run 45368418228 used it all, with no step stalled), so it gets twice the default.
    test.setTimeout(120_000);
    const owner = scratch(SCRATCH_INDEX);
    const joiner = scratchDesktop(SCRATCH_INDEX);
    // A name like one a person would give, with the run's tag so each run finds its own household.
    const tag = Date.now().toString(36);
    let name = `The Lee kitchen ${tag}`;

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
    await page.getByRole("form", { name: "Invite someone" }).getByRole("button", { name: "Copy invite link", exact: true }).click();
    const linkField = page.getByLabel("Invite link");
    await expect(linkField).toHaveValue(/\/join\/[A-Za-z0-9_-]{43}$/);
    const inviteUrl = await linkField.inputValue();
    await expectAccessible();
    await attachElementScreenshot(testInfo, page.getByRole("region", { name: "Invite someone" }), "owner-invite-link");

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
      await expect(joinerPage.getByRole("button", { name: "Copy invite link", exact: true })).toHaveCount(0);
      await attachScreenshot(testInfo, joinerPage, "joiner-household");

      // The owner sees them too, after a reload.
      await verifyAfterReload(async () => {
        await expect(people(page).getByText(joiner.username, { exact: true })).toBeVisible();
        await expect(people(page).getByText("Member", { exact: true })).toBeVisible();
      });
      await attachScreenshot(testInfo, page, "owner-household");

      // The owner renames the household; the joiner sees the new name on their next load, and has no name to change.
      const renamed = `The Lee and Okafor kitchen ${tag}`;
      const nameField = page.getByLabel("Household name");
      await expect(nameField).toHaveValue(name);
      await nameField.fill(renamed);
      await Promise.all([saved(page, householdPath), page.getByRole("button", { name: "Save name", exact: true }).click()]);
      await expect(page.getByRole("heading", { level: 1, name: renamed, exact: true })).toBeVisible();
      name = renamed;
      await verifyAfterReload(async () => {
        await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
        await expect(page.getByLabel("Household name")).toHaveValue(name);
      });
      await expectAccessible();
      await attachScreenshot(testInfo, page, "owner-renamed-household");
      await joinerPage.reload({ waitUntil: "load" });
      await expect(joinerPage.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
      await expect(joinerPage.getByLabel("Household name")).toHaveCount(0);
      await attachScreenshot(testInfo, joinerPage, "joiner-sees-new-name");

      // The owner makes a shared list; the joiner adds to it, and the owner checks it off. Each sees the other's
      // change on their next load.
      await page.getByRole("link", { name: /Shopping lists/ }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Shopping lists", exact: true })).toBeVisible();
      await page.getByLabel("List name").fill("Groceries");
      await page.getByRole("button", { name: "Make list", exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Groceries", exact: true })).toBeVisible();
      const listPath = new URL(page.url()).pathname;

      await joinerPage.goto(listPath);
      await waitForHydration(joinerPage);
      await joinerPage.getByLabel("Add an item").fill("2 litres milk");
      await joinerPage.getByRole("button", { name: "Add", exact: true }).click();
      await expect(joinerPage.getByRole("checkbox", { name: "2 litres milk" })).toBeVisible();
      await attachScreenshot(testInfo, joinerPage, "joiner-added-item");

      await verifyAfterReload(async () => {
        await expect(page.getByText(`Added by ${joiner.username}`, { exact: true })).toBeVisible();
      });
      await Promise.all([saved(page, listPath), page.getByRole("checkbox", { name: "2 litres milk" }).click()]);
      await expect(page.getByRole("checkbox", { name: "2 litres milk" })).toBeChecked();
      await verifyAfterReload(async () => {
        await expect(page.getByRole("checkbox", { name: "2 litres milk" })).toBeChecked();
      });
      await expectAccessible();
      // The owner made the list, so the owner can delete it.
      await expect(page.getByRole("button", { name: "Delete list", exact: true })).toBeVisible();
      await attachScreenshot(testInfo, page, "owner-shared-list");
      await joinerPage.reload({ waitUntil: "load" });
      await expect(joinerPage.getByRole("checkbox", { name: "2 litres milk" })).toBeChecked();
      // The joiner is a member who didn't make the list: they add, tick and remove items, but can't delete the list,
      // on the page or by posting to it.
      await expect(joinerPage.getByRole("button", { name: "Remove 2 litres milk", exact: true })).toBeVisible();
      await expect(joinerPage.getByRole("button", { name: "Delete list", exact: true })).toHaveCount(0);
      await attachScreenshot(testInfo, joinerPage, "joiner-shared-list");
      const refused = await joinerPage.request.post(listPath, { form: { intent: "delete" } });
      expect(refused.status()).toBe(403);
      await verifyAfterReload(async () => {
        await expect(page.getByRole("heading", { level: 1, name: "Groceries", exact: true })).toBeVisible();
      });
      await page.goto(householdPath);
      await waitForHydration(page);
      await joinerPage.goto(householdPath);
      await waitForHydration(joinerPage);

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

      // Now view-only, the joiner can read the shared list but not change it.
      await joinerPage.goto(listPath);
      await waitForHydration(joinerPage);
      await expect(joinerPage.getByRole("checkbox", { name: "2 litres milk" })).toBeChecked();
      await expect(joinerPage.getByRole("checkbox", { name: "2 litres milk" })).toBeDisabled();
      await expect(joinerPage.getByLabel("Add an item")).toHaveCount(0);
      await expect(joinerPage.getByText("You can see this list. An owner can let you add to it.", { exact: true })).toBeVisible();
      await expect(joinerPage.getByRole("button", { name: "Delete list", exact: true })).toHaveCount(0);
      await attachScreenshot(testInfo, joinerPage, "viewer-shared-list");

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

      // With no household left, the joiner's Kitchen offers to start one under Cook together, on desktop and at 390px.
      await joinerPage.goto("/");
      await waitForHydration(joinerPage);
      const joinerCookTogether = joinerPage.getByRole("region", { name: "Cook together" });
      await expect(joinerCookTogether.getByRole("list", { name: "Your households" })).toHaveCount(0);
      await expect(joinerCookTogether.getByRole("link", { name: "Start a household", exact: true })).toBeVisible();
      await attachLocatorScreenshot(testInfo, joinerCookTogether, "kitchen-start-a-household-desktop");
      await joinerPage.setViewportSize({ width: 390, height: 844 });
      await expect(joinerCookTogether.getByRole("link", { name: "Start a household", exact: true })).toBeVisible();
      await attachLocatorScreenshot(testInfo, joinerCookTogether, "kitchen-start-a-household-390");
      await joinerCookTogether.getByRole("link", { name: "Start a household", exact: true }).click();
      await expect(joinerPage).toHaveURL(pathUrl("/households"));
      await joinerPage.reload({ waitUntil: "load" });
      await expect(joinerPage.getByRole("heading", { level: 1, name: "Cook together", exact: true })).toBeVisible();
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

    // The owner's Kitchen lists it under Cook together, on desktop and at 390px, and it opens the household,
    // which is still there after a reload.
    await openFromKitchen(page, testInfo, { name, householdPath, width: 1280, height: 720, shot: "kitchen-cook-together-desktop" });
    await openFromKitchen(page, testInfo, { name, householdPath, width: 390, height: 844, shot: "kitchen-cook-together-390" });
    await attachScreenshot(testInfo, page, "household-from-kitchen-390");
  });

  test("an owner emails an invite from the one invite form, sees it wait after a reload, and cancels it @mutates", async ({
    page,
    verifyAfterReload,
    expectAccessible,
  }, testInfo) => {
    const tag = Date.now().toString(36);
    const name = `The Park kitchen ${tag}`;
    const address = `cook-${tag}@example.com`;

    await page.goto("/households");
    await waitForHydration(page);
    await page.getByLabel("Household name").fill(name);
    await page.getByRole("button", { name: "Create household", exact: true }).click();
    await expect(page).toHaveURL(HOUSEHOLD_URL);
    const householdPath = new URL(page.url()).pathname;
    await waitForHydration(page);

    // One form invites either way. The Journeys stack captures mail rather than sending it, so the email field is
    // offered as it is in production.
    const form = page.getByRole("form", { name: "Invite someone" });
    await expect(form.getByLabel("They join as")).toHaveCount(1);
    await form.getByLabel("Email address").fill(address);
    await form.getByLabel("They join as").selectOption("viewer");
    await Promise.all([saved(page, householdPath), form.getByRole("button", { name: "Send invite", exact: true }).click()]);
    await expect(page.getByRole("status").filter({ hasText: `Invite sent to ${address}.` })).toBeVisible();
    await expect(form.getByLabel("Email address")).toHaveValue("");
    await expectAccessible();
    await attachElementScreenshot(testInfo, form, "owner-invite-form");

    const waiting = page.getByRole("list", { name: "Waiting to join" });
    await verifyAfterReload(async () => {
      await expect(page.getByRole("heading", { level: 3, name: "Waiting to join" })).toBeVisible();
      await expect(waiting.getByText(address, { exact: true })).toBeVisible();
      await expect(waiting.getByText("View-only", { exact: true })).toBeVisible();
    });
    await attachElementScreenshot(testInfo, page.getByRole("region", { name: "Invite someone" }), "owner-email-invite-waiting-after-reload");

    // Cancelling the invite takes it off the list, and it stays off after a reload.
    await Promise.all([saved(page, householdPath), waiting.getByRole("button", { name: `Cancel invite to ${address}`, exact: true }).click()]);
    await verifyAfterReload(async () => {
      await expect(page.getByRole("list", { name: "Waiting to join" })).toHaveCount(0);
      await expect(page.getByText(address, { exact: true })).toHaveCount(0);
    });
    await attachElementScreenshot(testInfo, page.getByRole("region", { name: "Invite someone" }), "owner-email-invite-cancelled-after-reload");
  });
});
