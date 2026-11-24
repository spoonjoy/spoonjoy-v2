// Every page a journey opens itself (context.newPage()) must go through waitForHydrationOnLoad, which
// loads once more after a reset connection (support/app-ready.ts). The fixture's page gets it from
// support/journey.ts; a page a journey opens itself does not. Merge-queue Journeys run 45379629117
// dropped a pull request from the queue when site-footer.mobile.journey.ts's own page met
// "page.goto: Error receiving data: Connection reset by peer" and had no second try.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const JOURNEYS = "e2e/journeys";
const OWN_PAGE = /const (\w+) = await [\w.()]+\.newPage\(\);/g;

function journeyFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "support" ? [] : journeyFiles(path);
    return /\.(?:journey|setup)\.ts$/.test(entry.name) ? [path] : [];
  });
}

export function pagesWithoutLoadRetry(source: string): string[] {
  return [...source.matchAll(OWN_PAGE)]
    .filter((match) => !source.slice(match.index + match[0].length).trimStart().startsWith(`waitForHydrationOnLoad(${match[1]});`))
    .map((match) => match[1]);
}

describe("pages a journey opens itself", () => {
  it("each go through waitForHydrationOnLoad straight after they open", () => {
    const missing = journeyFiles(JOURNEYS).flatMap((file) =>
      pagesWithoutLoadRetry(readFileSync(file, "utf8")).map((name) => `${file}: ${name}`),
    );
    expect(missing).toEqual([]);
  });

  it("finds a page that skips it", () => {
    expect(pagesWithoutLoadRetry("const page = await context.newPage();\nawait page.goto(\"/\");")).toEqual(["page"]);
    expect(pagesWithoutLoadRetry("const page = await context.newPage();\n    waitForHydrationOnLoad(page);")).toEqual([]);
    expect(pagesWithoutLoadRetry("const second = await page.context().newPage();\nwaitForHydrationOnLoad(page);")).toEqual(["second"]);
  });

  it("sees every page the journeys open", () => {
    const count = journeyFiles(JOURNEYS).reduce((sum, file) => sum + [...readFileSync(file, "utf8").matchAll(OWN_PAGE)].length, 0);
    const raw = journeyFiles(JOURNEYS).reduce((sum, file) => sum + (readFileSync(file, "utf8").match(/\.newPage\(/g)?.length ?? 0), 0);
    expect(count).toBe(raw);
  });
});
