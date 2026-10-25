// Every story in the built Storybook, in the light and the dark theme, through the same
// fail-closed accessibility gate as the journeys (e2e/journeys/support/accessibility.ts): any axe
// violation fails, and so does any check axe could not decide unless a pixel measurement of the
// text's contrast settles it. The scan covers what Storybook's own a11y addon covers: the story's
// body without Storybook's chrome, and without the landmark rule (`region`), since a component on
// its own is not a page. Pages are checked whole by the journeys.
import { readFileSync } from "node:fs";
import { test } from "../ouro-fixtures";
import { COLOR_SCHEMES, auditShownScheme, describeAuditFailures } from "../journeys/support/accessibility";

interface IndexEntry {
  type: string;
  id: string;
  title: string;
  name: string;
}

const index = JSON.parse(readFileSync("storybook-static/index.json", "utf8")) as { entries: Record<string, IndexEntry> };
const stories = Object.values(index.entries).filter((entry) => entry.type === "story");
if (stories.length === 0) throw new Error("storybook-static/index.json lists no stories: build Storybook first.");

for (const story of stories) {
  for (const scheme of COLOR_SCHEMES) {
    test(`${story.title} / ${story.name} (${scheme})`, async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme: scheme });
      // a11y.manual stops the a11y addon running its own axe after the render, which would clash
      // with this run ("Axe is already running").
      await page.goto(`iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story&globals=theme:${scheme};a11y.manual:!true`);
      // Rendered, as Ouro UI's specs wait for a story (e2e/ouro/story.ts), and in the theme asked
      // for: the theme decorator sets the class on <html> after the render. The audit then waits
      // for fonts, images and animations to settle.
      await page.locator("#storybook-root > *").first().waitFor();
      await page.waitForFunction((dark) => document.documentElement.classList.contains("dark") === dark, scheme === "dark");

      const audit = await auditShownScheme(page, { target: "story" });
      if (audit.scheme !== scheme) throw new Error(`The story showed its ${audit.scheme} theme, not its ${scheme} one.`);
      await testInfo.attach("accessibility", { body: JSON.stringify(audit, null, 2), contentType: "application/json" });
      const failure = describeAuditFailures([audit]);
      if (failure) throw new Error(failure);
    });
  }
}
