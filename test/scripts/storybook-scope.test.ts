import { describe, expect, it, vi } from "vitest";
import { ALWAYS_RUN_PATHS, storybookScope } from "../../scripts/storybook-scope.mjs";

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
