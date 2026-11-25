// HX token fields as the journeys use them: the Organize form's tags, categories and tools, and any other Combobox
// with chips. On a phone (iphone-webkit) the field is a button that opens a sheet; on a desktop it is typed into.
import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect } from "./journey";

// One part of the page, scrolled to the top of the viewport first so the floating tab bar doesn't cover it.
export async function attachElementShot(element: Locator, testInfo: TestInfo, name: string): Promise<void> {
  await element.evaluate((node) => node.scrollIntoView({ block: "start" }));
  await testInfo.attach(`${name}-${testInfo.project.name}`, {
    body: await element.screenshot({ animations: "disabled" }),
    contentType: "image/png",
  });
}

// The token field for one kind, by the hidden marker the Organize form sends for it.
export function tokenField(page: Page, segment: string): Locator {
  return page.locator(`div:has(> input[name="organize"][value="${segment}"])`);
}

// A chip's Remove button, which is how a chip is named.
export function chipRemove(field: Locator, name: string): Locator {
  return field.getByRole("button", { name: `Remove ${name}`, exact: true });
}

// A token field's input: in the form, or on a phone (iphone-webkit) in the sheet its button opens. `done` closes it.
export async function openTokens(page: Page, label: string, phone: boolean): Promise<{ input: Locator; scope: Page | Locator; done: () => Promise<void> }> {
  const field = page.getByRole("combobox", { name: label, exact: true });
  if (!phone) {
    await field.click();
    return { input: field, scope: page, done: () => field.press("Escape") };
  }
  // The phone's field is a button that opens the sheet: a combobox while empty, a plain button once it shows chips.
  await field.or(page.getByRole("button", { name: label, exact: true })).click();
  const sheet = page.getByRole("dialog", { name: label, exact: true });
  await expect(sheet).toBeVisible();
  const input = sheet.getByRole("combobox", { name: label, exact: true });
  await input.click();
  return {
    input,
    scope: sheet,
    done: async () => {
      // The footer's Done; the sheet's close button is also called Done.
      await sheet.locator('[data-ouro-part="done"]').click();
      await expect(sheet).toHaveCount(0);
    },
  };
}

// Types a name the cook doesn't have yet and makes it a chip: Enter in the form, the sheet's Add row on a phone.
export async function addNewToken(page: Page, label: string, name: string, phone: boolean): Promise<void> {
  const { input, scope, done } = await openTokens(page, label, phone);
  await input.pressSequentially(name);
  if (phone) await scope.getByRole("option", { name: `Add “${name}”`, exact: true }).click();
  else await input.press("Enter");
  await done();
}

// Types `typed` and picks the cook's existing `name` from the suggestions.
export async function addSuggestedToken(page: Page, label: string, typed: string, name: string, phone: boolean): Promise<void> {
  const { input, scope, done } = await openTokens(page, label, phone);
  await input.pressSequentially(typed);
  await expect(scope.getByRole("option", { name: `Add “${typed}”`, exact: true })).toHaveCount(0);
  await scope.getByRole("option", { name, exact: true }).click();
  await done();
}

// Picks an item whose row starts with `name` (a row can carry a second line, such as the organizer's kind) in a field
// that takes only its items: types `name`, then picks its row.
export async function pickToken(page: Page, label: string, name: string, phone: boolean): Promise<void> {
  const { input, scope, done } = await openTokens(page, label, phone);
  await input.pressSequentially(name);
  const escaped = name.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
  await scope.getByRole("option", { name: new RegExp(`^${escaped}`) }).click();
  await done();
}

// Removes a chip: its Remove button in the form, or picking its row again in the phone's sheet.
export async function removeToken(page: Page, label: string, name: string, phone: boolean): Promise<void> {
  if (!phone) {
    await page.getByRole("button", { name: `Remove ${name}`, exact: true }).click();
    return;
  }
  const { scope, done } = await openTokens(page, label, phone);
  await scope.getByRole("option", { name, exact: true }).click();
  await done();
}
