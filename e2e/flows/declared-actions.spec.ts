import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { requiredLabel } from "../journeys/support/forms";

// add_shopping_list_item is declared once (actions/spoonjoy.actions.mts). This proves two of its
// doors on the running app: the person's Add to list button, and the WebMCP tool an agent in the
// person's browser calls. Both captures go into the `screens` artifact for review.

const OUT = "screens";
mkdirSync(OUT, { recursive: true });

function row(page: Page, name: string) {
  return page.getByRole("checkbox", { name, exact: true });
}

test.describe("add_shopping_list_item, declared once", () => {
  test("the person adds with the generated Add to list control", async ({ page }) => {
    await page.goto("/shopping-list");
    const add = page.locator("#add-item").getByRole("button", { name: "Add to list", exact: true });
    await expect(add).toHaveAttribute("data-ax-action", "add-shopping-list-item");

    await page.getByLabel(requiredLabel("Item"), { exact: true }).fill("3 tins chickpeas");
    await add.click();

    await expect(row(page, "chickpeas")).toBeVisible();
    await page.screenshot({ path: `${OUT}/declared-action-add-to-list-button.png`, fullPage: true, animations: "disabled" });
  });

  test("an agent in the person's browser adds with the declared WebMCP tool", async ({ page }) => {
    // A stand-in for the browser's WebMCP: it keeps what the page registers, so the test can call it
    // the way an agent would.
    await page.addInitScript(() => {
      const tools = new Map<string, { execute: (input: unknown) => Promise<unknown> }>();
      Object.defineProperty(navigator, "modelContext", {
        value: {
          registerTool: (tool: { name: string; execute: (input: unknown) => Promise<unknown> }) => tools.set(tool.name, tool),
          unregisterTool: (name: string) => tools.delete(name),
        },
      });
      (window as unknown as { __webmcpTools: typeof tools }).__webmcpTools = tools;
    });
    await page.goto("/shopping-list");
    await expect.poll(() => page.evaluate(() => [...(window as unknown as { __webmcpTools: Map<string, unknown> }).__webmcpTools.keys()])).toEqual([
      "add_shopping_list_item",
    ]);

    const result = await page.evaluate(() =>
      (window as unknown as { __webmcpTools: Map<string, { execute: (input: unknown) => Promise<unknown> }> }).__webmcpTools
        .get("add_shopping_list_item")!
        .execute({ name: "oat milk", quantity: 2, unit: "cartons" }),
    );
    expect(result).not.toHaveProperty("isError");

    await expect(row(page, "oat milk")).toBeVisible();
    await page.screenshot({ path: `${OUT}/declared-action-webmcp-add.png`, fullPage: true, animations: "disabled" });
  });
});
