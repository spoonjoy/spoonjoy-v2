import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";
import { ALWAYS_RUN_PATHS, STORY_ALWAYS_RUN_PATHS, storybookScope, storyScope } from "../../scripts/storybook-scope.mjs";

const BASE = "a".repeat(40);
const LIST_FILE = "/tmp/ouro-list.json";

function deps({ event = "pull_request", base = BASE, diff = "app/routes/plan.tsx\n", diffStatus = 0, listStatus = 0, listed = [] as unknown } = {}) {
  const run = vi.fn(() => listStatus);
  const capture = vi.fn(() => ({ status: diffStatus, stdout: diff }));
  const readFile = vi.fn(() => JSON.stringify(listed));
  return { env: { GITHUB_EVENT_NAME: event, SPOONJOY_OURO_BASE: base }, run, capture, readFile, removeFile: vi.fn(), listFile: LIST_FILE };
}

describe("storybookScope", () => {
  it("skips the Ouro UI tests when no file they import or read changed", () => {
    const d = deps();
    expect(storybookScope(d)).toEqual({ ouro: false, reason: `No Ouro UI test or spec input changed since ${BASE}.` });
    expect(d.capture).toHaveBeenCalledWith("git", ["diff", "--name-only", "--no-renames", BASE, "HEAD"]);
    expect(d.run).toHaveBeenCalledWith("pnpm", ["exec", "vitest", "list", "--config", "vitest.ouro.config.ts", "--changed", BASE, "--filesOnly", `--json=${LIST_FILE}`]);
    expect(d.removeFile).toHaveBeenCalledWith(LIST_FILE);
  });

  it("runs them when a change reaches an Ouro UI test through imports", () => {
    const d = deps({ listed: [{ file: "/repo/app/components/ouro/button/button.test.tsx" }] });
    expect(storybookScope(d)).toEqual({ ouro: true, reason: "1 Ouro UI test file(s) import a changed file." });
  });

  it.each([
    ".storybook/preview.tsx",
    "e2e/ouro/button.spec.ts",
    "playwright.ouro.config.ts",
    "app/styles/tailwind.css",
    ".github/workflows/storybook.yml",
    "scripts/storybook-scope.mjs",
    "pnpm-lock.yaml",
  ])("runs them when %s changes, which the import graph does not see", (file) => {
    const d = deps({ diff: `app/routes/plan.tsx\n${file}\n` });
    expect(storybookScope(d)).toEqual({ ouro: true, reason: `${file} changed, and the Ouro UI tests or specs read it.` });
    expect(d.run).not.toHaveBeenCalled();
  });

  it("names each always-run path by a pattern", () => {
    expect(ALWAYS_RUN_PATHS.every((pattern) => pattern instanceof RegExp)).toBe(true);
  });

  it("runs them on main, on dispatches and without a base commit", () => {
    expect(storybookScope(deps({ event: "push" })).ouro).toBe(true);
    expect(storybookScope(deps({ event: "workflow_dispatch" })).ouro).toBe(true);
    expect(storybookScope(deps({ base: "" }))).toEqual({ ouro: true, reason: "No base commit to compare with, so the Ouro UI tests run." });
  });

  it("runs them in the merge queue unless the group changes none of their inputs", () => {
    expect(storybookScope(deps({ event: "merge_group" })).ouro).toBe(false);
  });

  it("runs them when the diff or the listing fails, or nothing changed", () => {
    expect(storybookScope(deps({ diffStatus: 1 })).ouro).toBe(true);
    expect(storybookScope(deps({ listStatus: 1 })).ouro).toBe(true);
    expect(storybookScope(deps({ listed: { not: "a list" } })).ouro).toBe(true);
    expect(storybookScope(deps({ diff: "" })).ouro).toBe(true);
  });
});

describe("storyScope", () => {
  it("skips Storybook on a pull request when no story or the preview imports a changed file", () => {
    const d = deps();
    expect(storyScope(d)).toEqual({ storybook: false, reason: `No story imports a file changed since ${BASE}.` });
    expect(d.run).toHaveBeenCalledWith("pnpm", ["exec", "vitest", "list", "--config", "vitest.stories-scope.config.ts", "--changed", BASE, "--filesOnly", `--json=${LIST_FILE}`]);
    expect(d.removeFile).toHaveBeenCalledWith(LIST_FILE);
  });

  it("builds it when a change reaches a story through imports", () => {
    expect(storyScope(deps({ listed: [{ file: "/repo/stories/Recipe/View/RecipeView.stories.tsx" }] }))).toEqual({
      storybook: true,
      reason: "1 story file(s) import a changed file.",
    });
  });

  it.each([
    ".storybook/preview.tsx",
    "stories/Introduction.mdx",
    "e2e/storybook/accessibility.spec.ts",
    "playwright.storybook.config.ts",
    "vitest.stories-scope.config.ts",
    "app/styles/tailwind.css",
    "public/favicon.ico",
    ".github/workflows/storybook.yml",
    "scripts/storybook-scope.mjs",
    "package.json",
  ])("builds it when %s changes, which the import graph does not see", (file) => {
    const d = deps({ diff: `app/routes/plan.tsx\n${file}\n` });
    expect(storyScope(d)).toEqual({ storybook: true, reason: `${file} changed, and Storybook reads it.` });
    expect(d.run).not.toHaveBeenCalled();
    expect(STORY_ALWAYS_RUN_PATHS.some((pattern: RegExp) => pattern.test(file))).toBe(true);
  });

  it("always builds it in the merge queue, on main and on dispatches", () => {
    for (const event of ["merge_group", "push", "workflow_dispatch"]) {
      expect(storyScope(deps({ event }))).toEqual({ storybook: true, reason: `A ${event} run builds Storybook.` });
    }
  });

  it("builds it without a base, when the diff or the listing fails, or nothing changed", () => {
    expect(storyScope(deps({ base: "" }))).toEqual({ storybook: true, reason: "No base commit to compare with, so Storybook builds." });
    expect(storyScope(deps({ diffStatus: 1 })).reason).toBe("The diff against the base failed, so Storybook builds.");
    expect(storyScope(deps({ diff: "" })).reason).toBe("No changed file was listed, so Storybook builds.");
    expect(storyScope(deps({ listStatus: 1 })).reason).toBe("Listing the affected stories failed, so Storybook builds.");
    expect(storyScope(deps({ listed: { not: "a list" } })).reason).toBe("The story listing was not a file list, so Storybook builds.");
  });

  it("lists the stories Storybook loads and the preview that wraps them", () => {
    const config = readFileSync("vitest.stories-scope.config.ts", "utf8");
    expect(config).toContain('include: ["stories/**/*.stories.{js,jsx,mjs,ts,tsx}", "app/components/ouro/**/*.stories.{ts,tsx}", ".storybook/preview.tsx"]');
    const main = readFileSync(".storybook/main.ts", "utf8");
    expect(main).toContain("'../stories/**/*.stories.@(js|jsx|mjs|ts|tsx)'");
    expect(main).toContain("'../app/components/ouro/**/*.stories.@(ts|tsx)'");
  });
});

describe("Storybook workflow scope", () => {
  const steps = parseDocument(readFileSync(".github/workflows/storybook.yml", "utf8")).toJS().jobs["build-storybook"].steps as { name?: string; if?: string }[];
  const step = (name: string) => steps.find((each) => each.name?.includes(name))!;

  it("decides the scope before building, and skips the build and story check only when it says so", () => {
    expect(steps.indexOf(step("Ouro UI test scope"))).toBeLessThan(steps.indexOf(step("Build Storybook")));
    expect(step("Build Storybook").if).toBe("steps.scope.outputs.storybook != 'false'");
    expect(step("Story accessibility").if).toBe("${{ !cancelled() && steps.scope.outputs.storybook != 'false' }}");
    expect(step("Ouro UI browser tests").if).toBe("steps.scope.outputs.ouro != 'false'");
  });
});
