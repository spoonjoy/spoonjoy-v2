import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("a link navigates", async ({ page }) => {
  await openStory(page, "text-link--in-context");
  await page.getByRole("link", { name: "our braising guide" }).click();
  await expect(page).toHaveURL(/#braising$/);
});

test("an external link opens a new tab and says so", async ({ page }) => {
  await openStory(page, "text-link--in-context");
  const link = page.getByRole("link", { name: "the original recipe (opens in a new tab)" });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
});

test("a reloadDocument link is a plain link the router never renders, in the same look", async ({ page }) => {
  await openStory(page, "text-link--document-navigation");
  const mcp = page.getByRole("link", { name: "the MCP server's details" });
  const recipes = page.getByRole("link", { name: "browse recipes" });
  await expect(recipes).toHaveAttribute("data-router-link", "");
  await expect(mcp).not.toHaveAttribute("data-router-link", "");
  await expect(mcp).toHaveAttribute("href", "#mcp");
  expect(await mcp.evaluate((element) => getComputedStyle(element).color)).toBe(await recipes.evaluate((element) => getComputedStyle(element).color));
  // The story's hrefs are in-page, so following one proves nothing about a document load; the
  // unit tests check that the router's link never renders it.
});
