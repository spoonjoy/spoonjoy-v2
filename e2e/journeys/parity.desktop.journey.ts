// The parity capture: Spoonjoy's canonical screens on web, saved as parity-<screen>-<device>-<scheme>.png
// so scripts/parity-sheet.rb in spoonjoy-apple can set each one beside the native app's shot of the
// same screen (desk task spoonjoy/web-native-visual-parity, plan Task 4). The names match the native
// ParityJourneys exactly.
//
// Screens: kitchen, recipe, cook-step, shopping, cookbooks, cookbook, chef, sign-in, kitchen-empty.
// The native app's sheet-add-to-list has no web counterpart (Add to list is one tap here), so the
// sheet shows that side as a labelled gap. Devices: iphone (iPhone 15, 393 x 852), duo-open (the
// iPhone Duo open and held like a book, 951 x 669; app/lib/fold.ts), ipad (iPad Pro 11, 834 x 1194)
// and desktop (1440 x 900). Schemes: light and dark.
//
// Read-only: the chef's seeded kitchen and the newbie's empty one, opened in a fresh browser context
// per device and scheme. Opening cook mode changes no saved progress (cooking.journey.ts's history
// tests do the same as the chef). Desktop Chrome only, because each test builds its own devices, as
// cooking-now-postures.desktop.journey.ts does. The shots go up as the parity-shots artifact.
import { test, expect, appendConsoleIssues, assertNoConsoleIssues, watchConsole } from "./support/journey";
import { waitForHydrationOnLoad } from "./support/app-ready";
import type { Browser, BrowserContextOptions, Page, TestInfo } from "@playwright/test";
import { pathUrl, waitForHydration } from "./support/navigation";
import { personaStorageStatePath } from "./support/personas";

const LEMON_RICE = "/recipes/qa-kitchen-recipe-lemon-rice";
const WEEKNIGHT = "/cookbooks/qa-kitchen-cookbook-weeknight";
const CHEF_PROFILE = "/users/qa_kitchen_chef";

type Scheme = "light" | "dark";

interface Device {
  name: "iphone" | "duo-open" | "ipad" | "desktop";
  context: BrowserContextOptions;
}

function touch(width: number, height: number): BrowserContextOptions {
  return { viewport: { width, height }, screen: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
}

const IPHONE: Device = { name: "iphone", context: touch(393, 852) };
const DUO_OPEN: Device = { name: "duo-open", context: touch(951, 669) };
const IPAD: Device = { name: "ipad", context: touch(834, 1194) };
const DESKTOP: Device = { name: "desktop", context: { viewport: { width: 1440, height: 900 } } };

/** The file name scripts/parity-sheet.rb pairs on. */
export function parityShotName(screen: string, device: Device["name"], scheme: Scheme): string {
  return `parity-${screen}-${device}-${scheme}`;
}

async function settle(page: Page) {
  await waitForHydration(page);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function shoot(page: Page, testInfo: TestInfo, screen: string, device: Device, scheme: Scheme) {
  const name = parityShotName(screen, device.name, scheme);
  const path = testInfo.outputPath(`${name}.png`);
  // Viewport only: a full-page screenshot resizes the window, which turns the book-held Duo tall.
  await page.screenshot({ path, animations: "disabled" });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

// heading: the page's exact h1, or undefined where the page's own h1 is not what this capture is
// about (the signed-out login form, the newbie's empty kitchen), so only an h1 is required.
async function open(page: Page, path: string, heading?: string) {
  await page.goto(path);
  await settle(page);
  await expect(page).toHaveURL(pathUrl(path));
  const h1 = heading === undefined
    ? page.getByRole("heading", { level: 1 }).first()
    : page.getByRole("heading", { level: 1, name: heading, exact: true });
  await expect(h1).toBeVisible();
}

async function withContext(
  browser: Browser,
  device: Device,
  scheme: Scheme,
  storageState: BrowserContextOptions["storageState"],
  body: (page: Page) => Promise<void>,
) {
  const context = await browser.newContext({ ...device.context, colorScheme: scheme, storageState });
  const page = await context.newPage();
  waitForHydrationOnLoad(page);
  const watcher = watchConsole(page);
  try {
    await body(page);
  } catch (error) {
    throw appendConsoleIssues(error, watcher.issues);
  } finally {
    watcher.dispose();
    await context.close();
  }
  assertNoConsoleIssues(watcher.issues);
}

async function chefScreens(page: Page, testInfo: TestInfo, device: Device, scheme: Scheme) {
  await open(page, "/", "My Kitchen");
  await shoot(page, testInfo, "kitchen", device, scheme);

  await open(page, LEMON_RICE, "Lemon Herb Rice");
  await shoot(page, testInfo, "recipe", device, scheme);

  await page.getByRole("link", { name: "Cook mode", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${LEMON_RICE}#cook$`));
  await expect(page.getByRole("button", { name: "Exit cook mode", exact: true })).toBeVisible();
  await shoot(page, testInfo, "cook-step", device, scheme);

  await open(page, "/shopping-list", "Shopping list");
  await shoot(page, testInfo, "shopping", device, scheme);

  await open(page, "/cookbooks", "Cookbooks");
  await shoot(page, testInfo, "cookbooks", device, scheme);

  await open(page, WEEKNIGHT, "Weeknight Dinners");
  await shoot(page, testInfo, "cookbook", device, scheme);

  await open(page, CHEF_PROFILE, "qa_kitchen_chef");
  await shoot(page, testInfo, "chef", device, scheme);
}

async function captureAll(browser: Browser, testInfo: TestInfo, device: Device, scheme: Scheme) {
  await withContext(browser, device, scheme, personaStorageStatePath("chef"), (page) => chefScreens(page, testInfo, device, scheme));

  await withContext(browser, device, scheme, personaStorageStatePath("newbie"), async (page) => {
    await open(page, "/");
    await shoot(page, testInfo, "kitchen-empty", device, scheme);
  });

  await withContext(browser, device, scheme, { cookies: [], origins: [] }, async (page) => {
    await open(page, "/login");
    await expect(page.locator("#main").getByRole("button", { name: "Log in", exact: true })).toBeVisible();
    await shoot(page, testInfo, "sign-in", device, scheme);
  });
}

test.describe("Parity capture", () => {
  test.describe.configure({ timeout: 240_000 });

  test("iPhone, light and dark", async ({ browser }, testInfo) => {
    await captureAll(browser, testInfo, IPHONE, "light");
    await captureAll(browser, testInfo, IPHONE, "dark");
  });

  test("the Duo open like a book, light and dark", async ({ browser }, testInfo) => {
    await captureAll(browser, testInfo, DUO_OPEN, "light");
    await captureAll(browser, testInfo, DUO_OPEN, "dark");
  });

  test("iPad, light and dark", async ({ browser }, testInfo) => {
    await captureAll(browser, testInfo, IPAD, "light");
    await captureAll(browser, testInfo, IPAD, "dark");
  });

  test("desktop, light and dark", async ({ browser }, testInfo) => {
    await captureAll(browser, testInfo, DESKTOP, "light");
    await captureAll(browser, testInfo, DESKTOP, "dark");
  });
});
