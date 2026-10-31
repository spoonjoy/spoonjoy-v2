// The site footer (read-only). Every page ends with a quiet "Built with Ouro HX" link to HX's site
// and "See all the components", which turns on X-ray: HX's Inspector outlines each HX component on
// the page and lists it with links to its docs and to the Spoonjoy file that renders it, at the
// commit that is running. The Test Kitchen's own X-ray switch drives the same X-ray.
import { existsSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect } from "./support/journey";
import { expectNoHydrationErrors } from "./support/hydration";
import { waitForHydration } from "./support/navigation";
import { personaStorageStatePath } from "./support/personas";

async function expectFooter(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await waitForHydration(page);
  await expectNoHydrationErrors(page);
  const footer = page.getByRole("contentinfo");
  await expect(footer, `${path}: footer`).toBeVisible();
  await expect(footer.getByRole("link", { name: "Built with Ouro HX", exact: true })).toHaveAttribute("href", "https://ui.ouro.bot/");
  await expect(footer.getByRole("button", { name: "See all the components", exact: true })).toBeVisible();
  await expect(page.locator("main#main").getByRole("contentinfo")).toHaveCount(0);
}

/**
 * Turns X-ray on from the footer, scrolls to the bottom and checks that X-ray's floating bar sits
 * below the footer's link and button rather than over them.
 */
async function expectXrayBarClearsFooter(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await waitForHydration(page);
  const footer = page.getByRole("contentinfo");
  await footer.getByRole("button", { name: "See all the components", exact: true }).click();
  const bar = page.getByRole("region", { name: "X-ray", exact: true });
  await expect(bar).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.scrollingElement!.scrollHeight));
  await expect.poll(() => page.evaluate(() => Math.ceil(window.scrollY + window.innerHeight) >= document.scrollingElement!.scrollHeight - 1), { message: `${path}: scrolled to the bottom` }).toBe(true);
  const barTop = (await bar.boundingBox())!.y;
  for (const control of [footer.getByRole("link", { name: "Built with Ouro HX", exact: true }), footer.getByRole("button", { name: "See all the components", exact: true })]) {
    await expect(control).toBeInViewport();
    const box = (await control.boundingBox())!;
    expect(box.y + box.height, `${path}: ${await control.textContent()} ends above X-ray's bar`).toBeLessThanOrEqual(barTop);
  }
}

test.describe("Site footer, signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the landing page ends with the footer", async ({ page, expectAccessible }) => {
    await expectFooter(page, "/");
    await expectAccessible();
  });

  test("the public recipes page ends with the footer", async ({ page, expectAccessible }) => {
    await expectFooter(page, "/recipes");
    await expectAccessible();
  });

  test("\"See all the components\" turns on X-ray, which lists the page's components with their docs and source", async ({ page }) => {
    await expectFooter(page, "/recipes");
    await page.getByRole("contentinfo").getByRole("button", { name: "See all the components", exact: true }).click();
    const bar = page.getByRole("region", { name: "X-ray", exact: true });
    await expect(bar).toBeVisible();
    await expect(page.locator('[data-ouro-control="inspector"][data-ouro-part="tag"]').first()).toBeAttached();

    await bar.locator('[data-ouro-part="list"]').click();
    const list = page.getByRole("dialog", { name: "X-ray", exact: true });
    await expect(list.getByRole("link", { name: "Docs for link (opens in a new tab)", exact: true }).first()).toHaveAttribute("href", "https://ui.ouro.bot/docs/link/");
    // The footer's own link is rendered by app/components/navigation/site-footer.tsx; the file is
    // checked in this checkout rather than fetched, since github.com rate-limits CI runners.
    const source = list.getByRole("link", { name: "Source of link (opens in a new tab)", exact: true }).first();
    await expect(source).toHaveAttribute("href", /^https:\/\/github\.com\/spoonjoy\/spoonjoy-v2\/blob\/[0-9a-f]{40}\/app\/[^?#]+\.tsx$/);
    const sourcePath = new URL((await source.getAttribute("href"))!).pathname.split("/").slice(5).join("/");
    expect(existsSync(sourcePath), `${sourcePath} exists`).toBe(true);
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await bar.getByRole("button", { name: "Close", exact: true }).click();
    await expect(bar).toBeHidden();
  });

  // Signed out, the login page has no phone tab bar, so on the iPhone project too the bar would sit on the footer.
  test("X-ray's bar leaves the footer readable on the login page", async ({ page }) => {
    await expectXrayBarClearsFooter(page, "/login");
  });

  test("the footer and the Test Kitchen's switch share one X-ray", async ({ page }) => {
    await expectFooter(page, "/test-kitchen");
    const xray = page.getByRole("switch", { name: "X-ray", exact: true });
    await expect(xray).toHaveAttribute("aria-checked", "false");
    await page.getByRole("contentinfo").getByRole("button", { name: "See all the components", exact: true }).click();
    await expect(page.getByRole("region", { name: "X-ray", exact: true })).toHaveCount(1);
    await expect(xray).toHaveAttribute("aria-checked", "true");
    await xray.click();
    await expect(page.getByRole("region", { name: "X-ray", exact: true })).toHaveCount(0);
  });
});

test.describe("Site footer, signed in", () => {
  test.use({ storageState: personaStorageStatePath("chef") });

  test("the cookbooks page ends with the footer", async ({ page, expectAccessible }) => {
    await expectFooter(page, "/cookbooks");
    await expectAccessible();
  });
});
