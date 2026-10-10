import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  FORCE_LABEL,
  MAX_LISTED_FILES,
  NEVER_SKIP,
  SKIPPABLE_PATHS,
  decide,
  isCliEntry,
  pullRequestFiles,
  pullRequestLabels,
  runCommand,
  runJourneysScope,
  skippableReason,
} from "../../scripts/journeys-scope.mjs";

const REPOSITORY = "spoonjoy/spoonjoy-v2";
const OUTPUT = "/tmp/github-output";
const SUMMARY = "/tmp/github-step-summary";

function scopeEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    GITHUB_REPOSITORY: REPOSITORY,
    PR_NUMBER: "438",
    GITHUB_OUTPUT: OUTPUT,
    GITHUB_STEP_SUMMARY: SUMMARY,
    ...overrides,
  };
}

function githubRunner({
  files = [[{ filename: "docs/guide.md" }]] as unknown,
  labels = [{ name: "documentation" }] as unknown,
}: { files?: unknown; labels?: unknown } = {}) {
  return vi.fn(async (file: string, args: readonly string[]) => {
    const command = [file, ...args].join(" ");
    if (command === `gh api --paginate --slurp repos/${REPOSITORY}/pulls/438/files?per_page=100`) {
      return typeof files === "string" ? files : JSON.stringify(files);
    }
    if (command === `gh api repos/${REPOSITORY}/issues/438/labels?per_page=100`) {
      return typeof labels === "string" ? labels : JSON.stringify(labels);
    }
    throw new Error(`Unexpected command: ${command}`);
  });
}

async function scope(env: NodeJS.ProcessEnv, run: ReturnType<typeof githubRunner>) {
  const appendFile = vi.fn();
  const decision = await runJourneysScope({ env, run, appendFile });
  const summary = appendFile.mock.calls.find(([file]) => file === SUMMARY)?.[1] as string;
  return { decision, appendFile, summary };
}

describe("skippableReason", () => {
  it.each([
    "docs/qa/journeys.md",
    "CONTRIBUTING.md",
    "app/routes/README.md",
    ".github/workflows/apple-release.yml",
    ".github/workflows/qa-run-sweep.yaml",
    "test/scripts/qa-run-scope.test.ts",
    "scripts/qa-run-scope.test.mjs",
    "workers/cook-session.test.ts",
    "LICENSE",
  ])("lets %s skip", (file) => {
    expect(skippableReason(file)).not.toBeNull();
  });

  it.each([
    // What the app renders and how it behaves.
    "app/routes/recipes.$id.tsx",
    "app/components/Button.tsx",
    "app/lib/shopping-list.server.ts",
    "app/styles/app.css",
    "app/root.tsx",
    "workers/cook-session.ts",
    "worker/index.ts",
    "migrations/0042_add_column.sql",
    "prisma/schema.prisma",
    "public/favicon.svg",
    "package.json",
    "pnpm-lock.yaml",
    "wrangler.json",
    "vite.config.ts",
    "tailwind.config.js",
    // How Journeys deploys and drives the app.
    ".github/workflows/journeys.yml",
    ".github/actions/setup/action.yml",
    "e2e/journeys/shopping-list.journey.ts",
    "e2e/journeys/personas.setup.ts",
    "e2e/shopping.test.ts",
    "playwright.journeys.config.ts",
    "scripts/qa-run-scope.mjs",
    "scripts/seed-qa-kitchen.mjs",
    // Tailwind builds the shipped CSS from every file under app/ and from stories/.
    "app/lib/recipe.test.ts",
    "app/components/Button.test.tsx",
    "app/components/Button.stories.tsx",
    "stories/Button.stories.tsx",
    // Read by the "Check the QA config" step (scripts/qa-preflight.ts).
    ".github/workflows/ci.yml",
    ".github/workflows/production-deploy.yml",
    ".github/workflows/storybook.yml",
    "README.md",
    "docs/deployment.md",
    ".gitignore",
    // Unknown paths cost a run.
    "something-new/file.ts",
    "docs",
    "app/lib/notes.markdown",
  ])("runs the suite for %s", (file) => {
    expect(skippableReason(file)).toBeNull();
  });

  it("keeps the skip list and the force label exactly as reviewed", () => {
    // Widening the list lets more pull requests skip; change this pin only with a review of what
    // the new paths can affect.
    expect(SKIPPABLE_PATHS.map(({ pattern }) => pattern.source)).toEqual([
      "^docs\\/",
      "\\.md$",
      "^\\.github\\/workflows\\/(?!journeys\\.yml$)[^/]+\\.ya?ml$",
      "^test\\/",
      "^(?:workers|worker|scripts)\\/(?:.+\\/)?[^/]+\\.test\\.(?:ts|mjs|js)$",
      "^(?:LICENSE|\\.editorconfig)$",
    ]);
    expect(FORCE_LABEL).toBe("visual");
  });

  it("never lets a file the QA config check reads skip", () => {
    const preflight = readFileSync("scripts/qa-preflight.ts", "utf8");
    const read = [...preflight.matchAll(/path\.join\(rootDir, "([^"]+)"\)/g)].map(([, file]) => file);
    expect(read).toEqual(expect.arrayContaining([".github/workflows/ci.yml", "docs/deployment.md"]));
    for (const file of read) expect([file, skippableReason(file)]).toEqual([file, null]);
    for (const file of NEVER_SKIP) expect(read).toContain(file);
  });

  it("never lets a file the Journeys workflow itself uses skip", () => {
    const workflow = readFileSync(".github/workflows/journeys.yml", "utf8");
    const referenced = [...workflow.matchAll(/(?<![\w./-])(?:scripts|e2e)\/[A-Za-z0-9_./-]+\.(?:mjs|ts|jq|js)/g)].map(([file]) => file);
    referenced.push(
      ".github/workflows/journeys.yml",
      "playwright.journeys.config.ts",
      "playwright.explore.config.ts",
      "e2e/support/disposable-auth.ts",
      "app/styles/tailwind.css",
    );
    expect(referenced.length).toBeGreaterThan(5);
    for (const file of referenced) expect([file, skippableReason(file)]).toEqual([file, null]);
  });
});

describe("decide", () => {
  it("skips only when every changed file is skippable", () => {
    expect(decide({ files: ["docs/a.md", "test/a.test.ts", ".github/workflows/apple-release.yml"], labels: [] })).toEqual({
      journeys: false,
      why: expect.stringContaining("All 3 changed file(s)"),
    });
    const mixed = decide({ files: ["docs/a.md", "app/routes/home.tsx"], labels: [] });
    expect(mixed.journeys).toBe(true);
    expect(mixed.why).toContain("1 changed file(s) can affect rendering or the Journeys run, for example `app/routes/home.tsx`.");
  });

  it("shows at most ten of the files that need a run", () => {
    const files = Array.from({ length: 12 }, (_, index) => `app/lib/file-${index}.ts`);
    const { why } = decide({ files, labels: [] });
    expect(why).toContain("12 changed file(s)");
    expect(why).toContain("`app/lib/file-9.ts`");
    expect(why).not.toContain("`app/lib/file-10.ts`");
  });

  it(`runs the suite for the \`${FORCE_LABEL}\` label even when every file is skippable`, () => {
    expect(decide({ files: ["docs/a.md"], labels: ["bug", FORCE_LABEL] })).toEqual({
      journeys: true,
      why: `The pull request has the \`${FORCE_LABEL}\` label.`,
    });
  });

  it("runs the suite when the file list is empty or may be truncated", () => {
    expect(decide({ files: [], labels: [] }).journeys).toBe(true);
    const truncated = decide({ files: Array.from({ length: MAX_LISTED_FILES }, () => "docs/a.md"), labels: [] });
    expect(truncated.journeys).toBe(true);
    expect(truncated.why).toContain("may be incomplete");
  });
});

describe("pull request lookups", () => {
  it("lists every page of files, including a renamed file's old path", async () => {
    const run = githubRunner({
      files: [
        [{ filename: "docs/a.md" }],
        [{ filename: "docs/b.md", previous_filename: "app/routes/old.tsx" }],
      ],
    });
    expect(await pullRequestFiles(run, REPOSITORY, "438")).toEqual(["docs/a.md", "docs/b.md", "app/routes/old.tsx"]);
  });

  it.each([
    ["not JSON", "rate limited", /did not return valid JSON/],
    ["not a list of pages", JSON.stringify({ files: [] }), /file list is malformed/],
    ["a page that is not a list", JSON.stringify([{ filename: "docs/a.md" }]), /file list is malformed/],
    ["an entry without a filename", JSON.stringify([[{ filename: 7 }]]), /file list is malformed/],
    ["a null entry", JSON.stringify([[null]]), /file list is malformed/],
  ])("rejects a file list that is %s", async (_name, files, error) => {
    await expect(pullRequestFiles(githubRunner({ files }), REPOSITORY, "438")).rejects.toThrow(error);
  });

  it.each([
    ["not a list", JSON.stringify({ name: "visual" })],
    ["a label without a name", JSON.stringify([{ id: 1 }])],
    ["a null label", JSON.stringify([null])],
  ])("rejects a label list that is %s", async (_name, labels) => {
    await expect(pullRequestLabels(githubRunner({ labels }), REPOSITORY, "438")).rejects.toThrow(/label list is malformed/);
  });
});

describe("runJourneysScope", () => {
  it("lets a documentation-only pull request skip the suite", async () => {
    const { decision, appendFile, summary } = await scope(scopeEnv(), githubRunner());
    expect(decision.journeys).toBe(false);
    expect(appendFile).toHaveBeenCalledWith(OUTPUT, "journeys=false\n");
    expect(summary).toContain("### Journeys scope");
    expect(summary).toContain("The merge queue still runs it.");
  });

  it("reads the labels at run time, so adding visual and re-running forces the suite", async () => {
    const { decision, appendFile } = await scope(scopeEnv(), githubRunner({ labels: [{ name: FORCE_LABEL }] }));
    expect(decision.journeys).toBe(true);
    expect(appendFile).toHaveBeenCalledWith(OUTPUT, "journeys=true\n");
  });

  it.each([
    ["a lookup error", scopeEnv(), vi.fn(async () => { throw new Error("HTTP 502"); }), "(HTTP 502)"],
    ["a lookup error that is not an Error", scopeEnv(), vi.fn(async () => { throw "boom"; }), "(boom)"],
    ["a missing repository", scopeEnv({ GITHUB_REPOSITORY: "" }), githubRunner(), "GITHUB_REPOSITORY is required"],
    ["a missing pull request number", scopeEnv({ PR_NUMBER: "" }), githubRunner(), "PR_NUMBER is required"],
    ["an unset pull request number", (({ PR_NUMBER: _unset, ...env }) => env)(scopeEnv()), githubRunner(), "PR_NUMBER is required"],
    ["a malformed pull request number", scopeEnv({ PR_NUMBER: "438/../../x" }), githubRunner(), "must be a pull request number"],
  ])("runs the suite on %s", async (_name, env, run, why) => {
    const { decision, appendFile, summary } = await scope(env, run as ReturnType<typeof githubRunner>);
    expect(decision.journeys).toBe(true);
    expect(appendFile).toHaveBeenCalledWith(OUTPUT, "journeys=true\n");
    expect(summary).toContain(why);
  });

  it("fails, so the suite runs, without somewhere to write its answer", async () => {
    await expect(runJourneysScope({ env: scopeEnv({ GITHUB_OUTPUT: "" }), run: githubRunner(), appendFile: vi.fn() }))
      .rejects.toThrow("GITHUB_OUTPUT is required.");
    await expect(runJourneysScope({ env: scopeEnv({ GITHUB_STEP_SUMMARY: "" }), run: githubRunner(), appendFile: vi.fn() }))
      .rejects.toThrow("GITHUB_STEP_SUMMARY is required.");
  });

  it("uses the process environment by default", async () => {
    vi.stubEnv("GITHUB_OUTPUT", "");
    try {
      await expect(runJourneysScope()).rejects.toThrow("GITHUB_OUTPUT is required.");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("runs a real child command", async () => {
    expect(await runCommand(process.execPath, ["-e", "process.stdout.write('[]')"])).toBe("[]");
  });

  it("recognises its own CLI entry", () => {
    const moduleUrl = pathToFileURL("/repo/scripts/journeys-scope.mjs").href;
    expect(isCliEntry("/repo/scripts/journeys-scope.mjs", moduleUrl)).toBe(true);
    expect(isCliEntry("/repo/scripts/other.mjs", moduleUrl)).toBe(false);
    expect(isCliEntry(undefined, moduleUrl)).toBe(false);
  });
});
