import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const GENERATED_ARTIFACT_PATHS = [
  "coverage/",
  "build/",
  "playwright-report/",
  "test-results/",
  "storybook-static/",
  ".react-router/",
];

function gitLines(args: string[]) {
  const output = execFileSync("git", args, { encoding: "utf8" }).trim();
  return output ? output.split("\n") : [];
}

describe("generated artifact hygiene", () => {
  it("does not track generated local artifact directories", () => {
    expect(gitLines(["ls-files", ...GENERATED_ARTIFACT_PATHS])).toEqual([]);
  });

  it("keeps generated local artifact directories ignored", () => {
    for (const artifactPath of GENERATED_ARTIFACT_PATHS) {
      expect(() => execFileSync("git", ["check-ignore", "-q", artifactPath])).not.toThrow();
    }
  });
});

describe("UI audit tooling", () => {
  it("keeps the UI audit inventory and crawl scripts in the repo", () => {
    expect(existsSync("scripts/inventory-ui.mjs")).toBe(true);
    expect(existsSync("scripts/crawl-ui.mjs")).toBe(true);
    expect(existsSync("scripts/smoke-live.mjs")).toBe(true);
    expect(existsSync("scripts/cleanup-local-qa-data.mjs")).toBe(true);
  });

  it("documents repo-local UI audit commands instead of local skill paths", () => {
    const report = readFileSync("docs/ui-systems-audit-report.md", "utf8");

    expect(report).toContain("node scripts/inventory-ui.mjs");
    expect(report).toContain("node scripts/crawl-ui.mjs");
    expect(report).not.toContain("/Users/arimendelow/.codex/skills/ui-systems-audit/scripts");
  });

  it("fails crawls for skipped auth, failing HTTP, console errors, and visual defects", async () => {
    const { summarizeCrawlFailures } = await import("../scripts/crawl-ui.mjs");
    const route = { name: "recipe", path: "/recipes/r1" };

    expect(
      summarizeCrawlFailures([
        { route, viewport: "mobile", skipped: "auth-not-available" },
        { route, viewport: "desktop", httpStatus: 404 },
        { route, viewport: "tablet", consoleErrors: ["boom"], pageErrors: ["kaboom"] },
        {
          route,
          viewport: "mobile",
          audit: {
            horizontalOverflow: true,
            scrollWidth: 391,
            viewportWidth: 390,
            smallTargets: [{ label: "x" }],
            clippedText: [{ text: "y" }],
          },
        },
      ])
    ).toEqual([
      "mobile:recipe skipped (auth-not-available)",
      "desktop:recipe returned HTTP 404",
      "tablet:recipe logged 1 console error(s)",
      "tablet:recipe raised 1 page error(s)",
      "mobile:recipe has horizontal overflow (391px > 390px)",
      "mobile:recipe has 1 undersized target(s)",
      "mobile:recipe has 1 clipped text node(s)",
    ]);
  });

  it("allows auth skips only when explicitly requested", async () => {
    const { summarizeCrawlFailures } = await import("../scripts/crawl-ui.mjs");

    expect(
      summarizeCrawlFailures(
        [{ route: { name: "settings", path: "/account/settings" }, viewport: "mobile", skipped: "auth-not-available" }],
        { allowAuthSkips: true }
      )
    ).toEqual([]);
  });
});
