// Explore mode: records evidence about a fixed list of routes on QA, as the chef persona
// (stored session) and signed out, on both device projects. It never asserts app behaviour —
// that is what the *.journey.ts suite is for — so it is deliberately outside
// scripts/check-journey-rules.mjs's house rules (it is not named *.journey.ts or *.setup.ts,
// see journeyFileKind in that script) and may loop over routes and read dock items freely.
//
// Each persona's test visits every route in turn on the same page/context, recording per
// visit: the final URL, the document's HTTP status, console errors/warnings, pageerrors,
// failed requests (excluding third-party analytics/font hosts), axe violations of every
// impact, a full-page screenshot, and — on the mobile project only — the dock's items. All of
// a test's records are attached as a single JSON attachment named "summary"; the reporter in
// support/explore-report.ts merges every test's attachment into one explore-report/summary.json
// once the whole run ends (see that file for why this isn't written directly here).
//
// A visit never fails the test except on a real navigation crash: page.goto() only throws for
// an actual navigation failure (DNS, timeout, crash), never for a non-2xx response. Unlike the
// rest of a visit's collection, that call IS wrapped in a try/catch — not to swallow the
// crash (it is rethrown once this route's record and every prior route's evidence are safely
// persisted), but so a crash on route N doesn't discard routes 1..N-1's already-collected
// evidence. See the per-route try/catch/finally below.
//
// summary.json is uploaded as a public CI artifact, so every URL recorded here (failed-request
// URLs, the final page URL, and any URL appearing inside console/pageerror text) is redacted
// down to origin + pathname first — see support/redact.ts's redactUrl()/redactUrlsInText(),
// shared with the console gate in support/journey.ts for the same reason — dropping query
// strings, fragments, and userinfo that could carry search terms, tokens, or other data.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ConsoleMessage, Locator, Page, Request, Response } from "@playwright/test";
import { test } from "./support/journey";
import { personaStorageStatePath } from "./support/personas";
import { runAxe } from "./support/axe";
import { redactUrl, redactUrlsInText } from "./support/redact";
import { SUMMARY_ATTACHMENT_NAME, SUMMARY_OUTPUT_PATH, type VisitRecord } from "./support/explore-report";

const ROUTES = [
  "/",
  "/recipes",
  "/recipes/qa-kitchen-recipe-lemon-rice",
  "/recipes/qa-kitchen-recipe-risotto",
  "/recipes/qa-kitchen-recipe-lemon-rice#cook",
  "/search?q=lemon",
  "/search?q=tomato%2C%20lemon",
  "/cookbooks",
  "/cookbooks/qa-kitchen-cookbook-weeknight",
  "/shopping-list",
  "/my-recipes",
  "/saved-recipes",
  "/chefs",
  "/users/qa_kitchen_friend",
  "/account/settings",
  "/login",
  "/signup",
] as const;

const MOBILE_PROJECT_NAME = "iphone-webkit";
const DOCK_LANDMARK_NAME = "Spoonjoy navigation";

// Third-party hosts excluded from failed-request records: PostHog analytics and Google Fonts.
// A suffix match also covers every subdomain (e.g. i.posthog.com, us.i.posthog.com).
const EXCLUDED_HOST_SUFFIXES = ["posthog.com", "fonts.googleapis.com", "fonts.gstatic.com"];

function isExcludedRequestUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  return EXCLUDED_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

function slug(route: string): string {
  return route.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "root";
}

interface FailedRequestRecord {
  url: string;
  status?: number;
  failure?: string;
}

interface AxeViolationRecord {
  id: string;
  impact: string | null;
  targets: string[];
}

type DockItemRecord = { name: string; href: string | null } | { name: string; control: "button" };

// Resolves each dock item's true computed accessible name — including an aria-labelledby
// reference, which a hand-rolled `textContent ?? aria-label` read in page.evaluate() would
// miss — via Playwright's own aria snapshot of that one element, rather than reimplementing
// accessible-name computation. A leaf item's snapshot is a single line like `- link "Recipes"`
// or `- button "Search"`; an item with no accessible name has no quoted segment at all.
async function accessibleNameOf(locator: Locator): Promise<string> {
  const snapshot = await locator.ariaSnapshot();
  const match = snapshot.match(/^-\s*\S+\s+"([^"]*)"/);
  return match ? match[1] : "";
}

async function collectDockItems(page: Page): Promise<DockItemRecord[]> {
  const nav = page.getByRole("navigation", { name: DOCK_LANDMARK_NAME });
  if ((await nav.count()) === 0) return [];

  const items = nav.first().locator("a[href], button");
  const count = await items.count();
  const records: DockItemRecord[] = [];

  for (let index = 0; index < count; index += 1) {
    const item = items.nth(index);
    const [name, tagAndHref] = await Promise.all([
      accessibleNameOf(item),
      item.evaluate((node) => [node.tagName.toLowerCase(), node.getAttribute("href")] as const),
    ]);
    const [tagName, href] = tagAndHref;
    records.push(tagName === "a" ? { name, href: href ? redactUrl(href) : null } : { name, control: "button" });
  }

  return records;
}

function writePartialFile(records: VisitRecord[], personaName: string, device: string): void {
  const partialPath = path.join(path.dirname(SUMMARY_OUTPUT_PATH), `summary.${personaName}.${device}.json`);
  mkdirSync(path.dirname(partialPath), { recursive: true });
  writeFileSync(partialPath, `${JSON.stringify(records, null, 2)}\n`);
}

async function runExploreTest(page: Page, personaName: string): Promise<void> {
  const device = test.info().project.name;
  const records: VisitRecord[] = [];

  try {
    for (const route of ROUTES) {
      const consoleErrors: string[] = [];
      const consoleWarnings: string[] = [];
      const pageErrors: string[] = [];
      const failedRequests: FailedRequestRecord[] = [];

      const onConsole = (message: ConsoleMessage) => {
        if (message.type() === "error") consoleErrors.push(redactUrlsInText(message.text()));
        else if (message.type() === "warning") consoleWarnings.push(redactUrlsInText(message.text()));
      };
      const onPageError = (error: Error) => pageErrors.push(redactUrlsInText(error.message));
      const onRequestFailed = (request: Request) => {
        if (isExcludedRequestUrl(request.url())) return;
        failedRequests.push({ url: redactUrl(request.url()), failure: request.failure()?.errorText ?? "unknown" });
      };
      const onResponse = (response: Response) => {
        if (response.status() < 400 || isExcludedRequestUrl(response.url())) return;
        failedRequests.push({ url: redactUrl(response.url()), status: response.status() });
      };

      page.on("console", onConsole);
      page.on("pageerror", onPageError);
      page.on("requestfailed", onRequestFailed);
      page.on("response", onResponse);

      try {
        // The only call in this file allowed to throw past its own visit: a rejection here is
        // a real navigation crash (DNS, timeout, target crashed), never just a non-2xx
        // response, so it must still fail the test — see the catch block below.
        const response = await page.goto(route, { waitUntil: "load" });
        // Gives late console/pageerror/network events (e.g. deferred scripts) a moment to
        // arrive before this visit's listeners are detached below.
        await page.waitForTimeout(300);

        const axeResults = await runAxe(page);
        const isMobile = device === MOBILE_PROJECT_NAME;
        const screenshot = await page.screenshot({ fullPage: true });
        const attachmentName = `${personaName}--${device}--${slug(route)}`;
        await test.info().attach(attachmentName, { body: screenshot, contentType: "image/png" });

        const axeViolations: AxeViolationRecord[] = axeResults.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact ?? null,
          targets: violation.nodes.map((node) => node.target.join(" ")),
        }));

        records.push({
          route,
          persona: personaName,
          device,
          finalUrl: redactUrl(page.url()),
          httpStatus: response?.status() ?? null,
          consoleErrors,
          consoleWarnings,
          pageErrors,
          failedRequests,
          axeViolations,
          screenshot: attachmentName,
          ...(isMobile ? { dockItems: await collectDockItems(page) } : {}),
        });
      } catch (error) {
        // Keep whatever the listeners above already captured for this route, plus the error
        // itself, instead of losing the visit entirely — then rethrow so the test still fails
        // on a genuine crash. The finally block below still persists this record (and every
        // prior route's) before that rethrow propagates.
        records.push({
          route,
          persona: personaName,
          device,
          error: error instanceof Error ? error.message : String(error),
          consoleErrors,
          consoleWarnings,
          pageErrors,
          failedRequests,
        });
        throw error;
      } finally {
        page.off("console", onConsole);
        page.off("pageerror", onPageError);
        page.off("requestfailed", onRequestFailed);
        page.off("response", onResponse);

        // Written after every route, success or crash: this test's evidence-so-far is durable
        // on disk even if a later route crashes the whole test (or the process is killed
        // before the summary attachment below ever runs). Defense-in-depth alongside that
        // attachment; the reporter in support/explore-report.ts still owns the single merged
        // explore-report/summary.json once every persona x device test has finished.
        writePartialFile(records, personaName, device);
      }
    }
  } finally {
    // Runs whether the loop above finished cleanly or a route rethrew a crash, so the
    // attachment always reflects every route recorded so far (routes 1..N-1 plus route N's
    // own error record on a crash), never nothing at all.
    const body = Buffer.from(JSON.stringify(records, null, 2));
    await test.info().attach(SUMMARY_ATTACHMENT_NAME, { body, contentType: "application/json" });
  }
}

test.describe("Explore: chef", () => {
  // A path only, not persona("chef") — that eagerly reads SPOONJOY_QA_CREDENTIALS at test
  // collection time (via loadCredentials()), which would break `playwright test --list` when
  // no credentials file exists yet (see support/personas.ts's lazy-loading note).
  test.use({ storageState: personaStorageStatePath("chef") });

  test("records every route as the chef persona", async ({ page }) => {
    await runExploreTest(page, "chef");
  });
});

test.describe("Explore: signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("records every route signed out", async ({ page }) => {
    await runExploreTest(page, "signed-out");
  });
});
