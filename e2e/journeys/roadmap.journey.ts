// The public roadmap (signed out, read-only): anyone can read what has shipped, what is being built
// and what comes next and later, reached from the landing page and from every page's footer. The
// page is built from app/content/roadmap.ts, so its groups and rows are the same after a reload.
import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "./support/journey";
import { expectNoHydrationErrors } from "./support/hydration";
import { waitForHydration } from "./support/navigation";

const SHIPPED = "Cook one step at a time";
const LATER = "Follow chefs from the fediverse";

async function expectRoadmap(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { level: 1, name: "Roadmap", exact: true })).toBeVisible();
  for (const group of ["Shipped", "Building now", "Next", "Later"]) {
    await expect(page.getByRole("heading", { level: 2, name: group, exact: true })).toBeVisible();
  }
  const shipped = page.getByRole("region", { name: "Shipped", exact: true });
  await expect(shipped.getByText(SHIPPED, { exact: true })).toBeVisible();
  await expect(shipped.getByRole("link", { name: "Try it in the Test Kitchen", exact: true })).toHaveAttribute("href", "/test-kitchen");
  const later = page.getByRole("region", { name: "Later", exact: true });
  await expect(later.getByText(LATER, { exact: true })).toBeVisible();
  await expect(page.getByText("Move in from other recipe apps in one step", { exact: true })).toBeVisible();
  await expect(page.locator("main#main")).not.toContainText(/mealie/i);
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(`${name}-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true, animations: "disabled" }),
    contentType: "image/png",
  });
}

test.describe("Roadmap, signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a visitor reads a shipped and a later item, and they are still there after a reload", async ({ page, expectAccessible }, testInfo) => {
    await page.goto("/roadmap");
    await waitForHydration(page);
    await expectNoHydrationErrors(page);
    await expectRoadmap(page);
    await expectAccessible();
    await attachScreenshot(page, testInfo, "roadmap");

    await page.reload();
    await waitForHydration(page);
    await expectRoadmap(page);
  });

  test("the landing page and the footer both lead to the roadmap", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    await page.getByRole("link", { name: "See the roadmap", exact: true }).click();
    await expect(page).toHaveURL(/\/roadmap$/);
    await expectRoadmap(page);

    await page.goto("/recipes");
    await waitForHydration(page);
    await page.getByRole("contentinfo").getByRole("link", { name: "Roadmap", exact: true }).click();
    await expect(page).toHaveURL(/\/roadmap$/);
    await expectRoadmap(page);
  });
});
