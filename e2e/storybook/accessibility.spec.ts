// Every story in the built Storybook, in the light and the dark theme, through the same
// fail-closed accessibility gate as the journeys (e2e/journeys/support/accessibility.ts): any axe
// violation fails, and so does any check axe could not decide unless a pixel measurement of the
// text's contrast settles it. The scan covers what Storybook's own a11y addon covers, the story's
// body without Storybook's chrome, with every rule: the `page` global renders the story in <main>
// with its popups at the end of it, as the app does (.storybook/preview.tsx), so the landmark rule
// (`region`) fails content outside every landmark. Then each popup the story can open (a Select's
// list, a Menu, a Combobox's list, a Popover, a Dialog, a navigation panel) is opened in turn and
// checked the same way, as Ouro UI's own story check does, since a popup's content exists only
// while it is open.
import { readFileSync } from "node:fs";
import { test } from "../ouro-fixtures";
import { COLOR_SCHEMES, auditShownScheme, describeAuditFailures } from "../journeys/support/accessibility";
import { auditEachPopupOpen, type PopupAudit } from "./popups";

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
      // with this run ("Axe is already running"). page puts the story in a page's <main>.
      await page.goto(`iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story&globals=theme:${scheme};a11y.manual:!true;page:!true`);
      // Rendered, as Ouro UI's specs wait for a story (e2e/ouro/story.ts), with its play function
      // done, which is when Storybook's a11y addon checks it, and in the theme asked for: the theme
      // decorator sets the class on <html> after the render. The audit then waits for fonts,
      // images and animations to settle.
      // The story's own first element: the page's <main> around it has no size when all it holds is fixed.
      await page.locator("#storybook-root > :not([data-story-page]), [data-story-page] > :first-child").first().waitFor();
      const phase = await page.waitForFunction(() => {
        const render = (window as { __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } } }).__STORYBOOK_PREVIEW__?.currentRender;
        return ["finished", "errored", "aborted"].includes(render?.phase ?? "") && render?.phase;
      });
      if ((await phase.jsonValue()) !== "finished") throw new Error(`The story's render ended ${String(await phase.jsonValue())}, not finished.`);
      await page.waitForFunction((dark) => document.documentElement.classList.contains("dark") === dark, scheme === "dark");

      // Storybook's hidden chrome holds links ahead of the story, so axe would not take a skip link
      // for one (it must come before the page's first link). It is no part of the story.
      await page.evaluate(() => {
        for (const chrome of document.querySelectorAll(".sb-wrapper")) chrome.remove();
      });
      const audit = await auditShownScheme(page, { target: "story" });
      if (audit.scheme !== scheme) throw new Error(`The story showed its ${audit.scheme} theme, not its ${scheme} one.`);
      await testInfo.attach("accessibility", { body: JSON.stringify(audit, null, 2), contentType: "application/json" });
      // The buttons the story names as opening a popup without saying so, as Ouro UI's story check reads them.
      const plainOpeners = await page.evaluate(() => {
        const story = (window as { __STORYBOOK_PREVIEW__?: { currentRender?: { story?: { parameters?: { plainOpeners?: string[] } } } } }).__STORYBOOK_PREVIEW__?.currentRender?.story;
        if (!story?.parameters) throw new Error("Storybook did not expose the story's parameters.");
        return story.parameters.plainOpeners ?? [];
      });
      const opened: PopupAudit[] = [];
      let openError: string | null = null;
      try {
        await auditEachPopupOpen(page, "#storybook-root", { target: "story", plainOpeners }, opened);
      } catch (error) {
        openError = (error as Error).message;
      }
      if (opened.length > 0) await testInfo.attach("accessibility with each popup open", { body: JSON.stringify(opened, null, 2), contentType: "application/json" });
      const failures = [
        describeAuditFailures([audit]),
        ...opened.map(({ trigger, audit: open }) => {
          const failure = describeAuditFailures([open]);
          return failure && `With "${trigger}" open:\n${failure}`;
        }),
        openError,
      ].filter(Boolean);
      if (failures.length > 0) throw new Error(failures.join("\n"));
    });
  }
}
