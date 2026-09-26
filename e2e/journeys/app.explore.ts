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
// an actual navigation failure (DNS, timeout, crash), never for a non-2xx response, so it is
// intentionally left unguarded by a try/catch. Everything else is collected defensively.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ConsoleMessage, Page, Request, Response } from "@playwright/test";
import { test } from "./support/journey";
import { personaStorageStatePath } from "./support/personas";
import { runAxe } from "./support/axe";
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

async function collectDockItems(page: Page): Promise<DockItemRecord[]> {
  const nav = page.getByRole("navigation", { name: DOCK_LANDMARK_NAME });
  if ((await nav.count()) === 0) return [];

  return nav.first().evaluate((element) =>
    Array.from(element.querySelectorAll("a[href], button")).map((node) => {
      const name = (node.getAttribute("aria-label") ?? node.textContent ?? "").trim();
      if (node.tagName.toLowerCase() === "a") {
        return { name, href: node.getAttribute("href") };
      }
      return { name, control: "button" as const };
    }),
  );
}

async function exploreRoutes(page: Page, personaName: string, device: string): Promise<VisitRecord[]> {
  const records: VisitRecord[] = [];

  for (const route of ROUTES) {
    const consoleErrors: string[] = [];
    const consoleWarnings: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: FailedRequestRecord[] = [];

    const onConsole = (message: ConsoleMessage) => {
      if (message.type() === "error") consoleErrors.push(message.text());
      else if (message.type() === "warning") consoleWarnings.push(message.text());
    };
    const onPageError = (error: Error) => pageErrors.push(error.message);
    const onRequestFailed = (request: Request) => {
      if (isExcludedRequestUrl(request.url())) return;
      failedRequests.push({ url: request.url(), failure: request.failure()?.errorText ?? "unknown" });
    };
    const onResponse = (response: Response) => {
      if (response.status() < 400 || isExcludedRequestUrl(response.url())) return;
      failedRequests.push({ url: response.url(), status: response.status() });
    };

    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    page.on("requestfailed", onRequestFailed);
    page.on("response", onResponse);

    // Never wrapped in try/catch: a thrown navigation is a real crash and must fail the test.
    const response = await page.goto(route, { waitUntil: "load" });
    // Gives late console/pageerror/network events (e.g. deferred scripts) a moment to arrive
    // before this visit's listeners are detached below.
    await page.waitForTimeout(300);

    const axeResults = await runAxe(page);
    const isMobile = device === MOBILE_PROJECT_NAME;
    const screenshot = await page.screenshot({ fullPage: true });
    const attachmentName = `${personaName}--${device}--${slug(route)}`;
    await test.info().attach(attachmentName, { body: screenshot, contentType: "image/png" });

    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("requestfailed", onRequestFailed);
    page.off("response", onResponse);

    const axeViolations: AxeViolationRecord[] = axeResults.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? null,
      targets: violation.nodes.map((node) => node.target.join(" ")),
    }));

    records.push({
      route,
      persona: personaName,
      device,
      finalUrl: page.url(),
      httpStatus: response?.status() ?? null,
      consoleErrors,
      consoleWarnings,
      pageErrors,
      failedRequests,
      axeViolations,
      screenshot: attachmentName,
      ...(isMobile ? { dockItems: await collectDockItems(page) } : {}),
    });
  }

  return records;
}

async function runExploreTest(page: Page, personaName: string): Promise<void> {
  const device = test.info().project.name;
  const records = await exploreRoutes(page, personaName, device);
  const body = Buffer.from(JSON.stringify(records, null, 2));
  await test.info().attach(SUMMARY_ATTACHMENT_NAME, { body, contentType: "application/json" });

  // Defense-in-depth alongside the attachment: also persist this test's own slice directly, so
  // the evidence exists as a real file even if the reporter in support/explore-report.ts is
  // ever skipped or misconfigured. The reporter still owns writing the single merged
  // explore-report/summary.json once every persona x device test has finished.
  const partialPath = path.join(path.dirname(SUMMARY_OUTPUT_PATH), `summary.${personaName}.${device}.json`);
  mkdirSync(path.dirname(partialPath), { recursive: true });
  writeFileSync(partialPath, `${body.toString("utf8")}\n`);
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
