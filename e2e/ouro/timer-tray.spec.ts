import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("the timer tray lists the timers that are not idle and dismisses a finished one", async ({ page }) => {
  await openStory(page, "feedback-timertray--in-context");
  const tray = page.getByRole("region", { name: "Kitchen timers" });
  await expect(tray.getByRole("listitem")).toHaveCount(2);
  await expect(tray.getByRole("link", { name: "Go to Oven" })).toHaveAttribute("href", "#oven");
  await expect(tray.getByText("Time's up")).toBeVisible();
  const dismiss = tray.getByRole("button", { name: "Dismiss Eggs" });
  await dismiss.focus();
  await dismiss.press("Enter");
  await expect(tray.getByRole("listitem")).toHaveCount(1);
  // Focus moves to the timer that is left rather than falling to the page.
  const cancel = tray.getByRole("button", { name: "Cancel Oven" });
  await expect(cancel).toBeFocused();
  await cancel.press("Enter");
  // Stopping the last timer leaves focus on the tray, not the page, and it hides once focus moves on.
  await expect(tray).toBeFocused();
  await tray.evaluate((element) => (element as HTMLElement).blur());
  await expect(tray).toBeHidden();
});
