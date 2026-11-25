// A page's last row clears the phone's floating tab bar. Scrolled to the end of the page, the row's bottom edge sits
// at or above the bar's top, so the bar never covers its title, cover or badge. The shot attached is the visible
// screen only: a full-page shot draws a fixed bar over whatever is in the first screen's last rows, which is not what
// a cook sees. On the iPhone project the bar must show; on desktop, where it hides from lg, only the shot
// is taken.
import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";

export async function expectLastRowClearsTabBar(page: Page, row: Locator, testInfo: TestInfo, name: string): Promise<void> {
  await expect(row, `${name}: last row`).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.scrollingElement!.scrollHeight));
  await expect
    .poll(() => page.evaluate(() => Math.ceil(window.scrollY + window.innerHeight) >= document.scrollingElement!.scrollHeight - 1), { message: `${name}: scrolled to the end` })
    .toBe(true);

  const tabBar = page.getByRole("navigation", { name: "Spoonjoy navigation" });
  if (testInfo.project.name === "iphone-webkit") {
    await expect(tabBar, `${name}: tab bar`).toBeVisible();
    const rowBox = (await row.boundingBox())!;
    const barBox = (await tabBar.boundingBox())!;
    expect(rowBox.y + rowBox.height, `${name}: last row ends above the tab bar`).toBeLessThanOrEqual(barBox.y);
  }

  await testInfo.attach(`${name}-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: false, animations: "disabled" }),
    contentType: "image/png",
  });
}
