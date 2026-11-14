import { expect, test } from "../ouro-fixtures";
import { filmTops, openStory, pressTab, tapKeepsCancelledClick } from "./story";

test("typing filters the list, and Enter picks the highlighted item", async ({ page }) => {
  await openStory(page, "forms-combobox--modes");
  const herb = page.getByRole("combobox", { name: "Herb", exact: true });
  await herb.fill("");
  await herb.pressSequentially("ros");
  await expect(page.getByRole("option")).toHaveText(["Rosemary"]);
  await herb.press("ArrowDown");
  await herb.press("Enter");
  await expect(herb).toHaveValue("Rosemary");
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("multiple shows chips, and a chip's button removes it", async ({ page }) => {
  await openStory(page, "forms-combobox--modes");
  await expect(page.getByRole("button", { name: "Remove Basil" })).toBeVisible();
  await page.getByRole("button", { name: "Remove Basil" }).click();
  await expect(page.getByRole("button", { name: "Remove Basil" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove Mint" })).toBeVisible();
});

test("allowCustomValue keeps free text", async ({ page }) => {
  await openStory(page, "forms-combobox--modes");
  const cuisine = page.getByRole("combobox", { name: "Cuisine" });
  await cuisine.pressSequentially("Georgian");
  await pressTab(page);
  await expect(cuisine).toHaveValue("Georgian");
});

test.describe("by touch on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("a tap on the button opens the sheet, and a tap on an item picks it", async ({ page }) => {
    await openStory(page, "forms-combobox--modes");
    const keepsClick = await tapKeepsCancelledClick(page);
    // With a coarse pointer on a narrow screen, the field is a button that opens a sheet.
    const herb = page.getByRole("combobox", { name: "Herb", exact: true });
    await herb.tap();
    const sheet = page.getByRole("dialog", { name: "Herb" });
    await expect(sheet).toBeVisible();
    const rosemary = page.getByRole("option", { name: "Rosemary" });
    // The item the tap's pointerup reached, read on the document, so an item drawn again keeps it.
    await page.evaluate(() =>
      document.addEventListener("pointerup", (event) => (document.documentElement.dataset["tappedOption"] = (event.target as Element).closest('[role="option"]')?.textContent ?? ""), { capture: true, once: true }),
    );
    await rosemary.tap();
    // An item cancels pointerdown (Base UI's), so the search input keeps focus; a phone still
    // raises the tap's click. Where Playwright's WebKit drops it (tapKeepsCancelledClick), the
    // spec checks the tap reached the item, then raises the one click the tap lost, while the
    // sheet is still open to take it.
    if (!keepsClick) {
      await expect(page.locator("html")).toHaveAttribute("data-tapped-option", "Rosemary");
      if (await sheet.count()) await rosemary.dispatchEvent("click");
    }
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(herb).toContainText("Rosemary");
  });

  test("the sheet's search field, panel and top stay put on every frame while typing filters the list", async ({ page }) => {
    await openStory(page, "forms-combobox--modes");
    await page.getByRole("combobox", { name: "Herb", exact: true }).tap();
    const sheet = page.getByRole("dialog", { name: "Herb" });
    const search = sheet.getByRole("combobox", { name: "Herb" });
    const options = sheet.getByRole("option");
    await expect(options.first()).toBeVisible();
    expect(await options.count()).toBeGreaterThan(1);
    const film = await filmTops({ input: search, panel: sheet.locator("[data-ouro-sheet-content]"), sheet }, async () => {
      await search.tap();
      await search.pressSequentially("ros", { delay: 120 });
      await expect(options).toHaveText(["Rosemary"]);
    });
    // A frame or more for each key typed, so the film saw the typing and not only the frames after it.
    expect(film.actFrames).toBeGreaterThanOrEqual(3);
    expect(film.moves).toEqual([]);
  });
});
