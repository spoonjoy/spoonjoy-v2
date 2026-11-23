// The app's shared shell in the HX census: the banner, the footer and the two navigations (the
// desktop header's and the phone's tab bar). Every page shows it, so if each page's entry counted
// it, a new nav link would change every signed-in page's entry, and two pull requests that each add
// one would break each other in the merge queue. So the census hides the shell on every page
// (`hideShell`, run after each load, before the state's action) and counts it once per persona in
// its own journeys (`showOnlyShell`). Hidden here means `visibility: hidden`: the page keeps its
// layout, and the census and the accessibility audit both skip what a person can't see.
import type { Locator, Page } from "@playwright/test";

function shellLandmarks(page: Page): Locator[] {
  return [
    page.getByRole("banner"),
    page.getByRole("contentinfo"),
    page.getByRole("navigation", { name: "Main navigation", exact: true }),
    page.getByRole("navigation", { name: "Spoonjoy navigation", exact: true }),
  ];
}

// Hidden landmarks drop out of the accessibility tree, where getByRole can't find them again, so
// hiding marks them and showing finds them by the mark.
const HIDDEN_MARK = "data-census-shell-hidden";

/** Hides the shared shell, so a page's census entry counts only the page. */
export async function hideShell(page: Page): Promise<void> {
  for (const landmark of shellLandmarks(page)) {
    await landmark.evaluateAll((elements, mark) => {
      for (const element of elements) {
        (element as HTMLElement).style.visibility = "hidden";
        element.setAttribute(mark, "");
      }
    }, HIDDEN_MARK);
  }
}

async function showShell(page: Page): Promise<void> {
  await page.locator(`[${HIDDEN_MARK}]`).evaluateAll((elements, mark) => {
    for (const element of elements) {
      (element as HTMLElement).style.visibility = "";
      element.removeAttribute(mark);
    }
  }, HIDDEN_MARK);
}

/** Shows the shared shell again and empties main down to its heading, so the entry counts only the shell. */
export async function showOnlyShell(page: Page): Promise<void> {
  await showShell(page);
  // Main keeps only a plain copy of its level-one heading, in the page's own colours, so the
  // accessibility audit still finds a main landmark and a heading it can read, and no page control
  // counts. Hiding main's content instead left the heading over a hidden background (1:1 contrast).
  await page.getByRole("main").evaluate((main) => {
    const heading = document.createElement("h1");
    heading.textContent = main.querySelector("h1")?.textContent?.trim() || document.title;
    main.replaceChildren(heading);
  });
}
