import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  AFFECTED_PATHS,
  APP_WIDE_PATHS,
  FORCE_LABEL,
  MAX_AFFECTED_SPECS,
  MAX_LISTED_FILES,
  NEVER_SKIP,
  SKIPPABLE_PATHS,
  SMOKE_SPECS,
  SPEC_FILE,
  decide,
  headJourneySpecs,
  isCliEntry,
  pullRequestFiles,
  pullRequestLabels,
  relatedSpecs,
  runCommand,
  runJourneysScope,
  skippableReason,
} from "../../scripts/journeys-scope.mjs";

const REPOSITORY = "spoonjoy/spoonjoy-v2";
const OUTPUT = "/tmp/github-output";
const SUMMARY = "/tmp/github-step-summary";
const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";
const SPECS = [
  "e2e/journeys/cookbooks.journey.ts",
  "e2e/journeys/hx-census.journey.ts",
  "e2e/journeys/personas.setup.ts",
  "e2e/journeys/round-trips.journey.ts",
  "e2e/journeys/round-trips.mobile.journey.ts",
  "e2e/journeys/shopping-list.journey.ts",
  "e2e/journeys/shopping-list.mobile.journey.ts",
  "e2e/journeys/sign-in.journey.ts",
  "e2e/journeys/support",
];

function scopeEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    GITHUB_REPOSITORY: REPOSITORY,
    PR_NUMBER: "438",
    HEAD_SHA,
    GITHUB_OUTPUT: OUTPUT,
    GITHUB_STEP_SUMMARY: SUMMARY,
    ...overrides,
  };
}

function githubRunner({
  files = [[{ filename: "docs/guide.md" }]] as unknown,
  labels = [{ name: "documentation" }] as unknown,
  specs = SPECS.map((specPath) => ({ path: specPath })) as unknown,
}: { files?: unknown; labels?: unknown; specs?: unknown } = {}) {
  return vi.fn(async (file: string, args: readonly string[]) => {
    const command = [file, ...args].join(" ");
    if (command === `gh api --paginate --slurp repos/${REPOSITORY}/pulls/438/files?per_page=100`) {
      return typeof files === "string" ? files : JSON.stringify(files);
    }
    if (command === `gh api repos/${REPOSITORY}/issues/438/labels?per_page=100`) {
      return typeof labels === "string" ? labels : JSON.stringify(labels);
    }
    if (command === `gh api repos/${REPOSITORY}/contents/e2e/journeys?ref=${HEAD_SHA}`) {
      return typeof specs === "string" ? specs : JSON.stringify(specs);
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
    expect(decide({ files: ["docs/a.md", "test/a.test.ts", ".github/workflows/apple-release.yml"], labels: [], specs: SPECS })).toEqual({
      journeys: false,
      mode: "skip",
      census: false,
      specs: [],
      why: expect.stringContaining("All 3 changed file(s)"),
    });
    const mixed = decide({ files: ["docs/a.md", "package.json"], labels: [], specs: SPECS });
    expect(mixed).toMatchObject({ journeys: true, mode: "full", census: true, specs: [] });
    expect(mixed.why).toContain("1 changed file(s) are not app code or a journey spec, so the full suite runs, for example `package.json`.");
  });

  it("shows at most ten of the files that need the full suite", () => {
    const files = Array.from({ length: 12 }, (_, index) => `workers/file-${index}.ts`);
    const { why } = decide({ files, labels: [], specs: SPECS });
    expect(why).toContain("12 changed file(s)");
    expect(why).toContain("`workers/file-9.ts`");
    expect(why).not.toContain("`workers/file-10.ts`");
  });

  it(`runs the full suite for the \`${FORCE_LABEL}\` label even when every file is skippable`, () => {
    expect(decide({ files: ["docs/a.md"], labels: ["bug", FORCE_LABEL], specs: SPECS })).toEqual({
      journeys: true,
      mode: "full",
      census: true,
      specs: [],
      why: `The pull request has the \`${FORCE_LABEL}\` label.`,
    });
  });

  it("runs the full suite when the file list is empty or may be truncated", () => {
    expect(decide({ files: [], labels: [], specs: SPECS }).mode).toBe("full");
    const truncated = decide({ files: Array.from({ length: MAX_LISTED_FILES }, () => "app/a.ts"), labels: [], specs: SPECS });
    expect(truncated.mode).toBe("full");
    expect(truncated.why).toContain("may be incomplete");
  });

  it("runs only the affected specs, the smoke set and the census for an app change", () => {
    expect(decide({ files: ["app/routes/shopping-list.tsx", "docs/a.md"], labels: [], specs: SPECS })).toEqual({
      journeys: true,
      mode: "affected",
      census: true,
      specs: [
        "e2e/journeys/round-trips.journey.ts",
        "e2e/journeys/shopping-list.journey.ts",
        "e2e/journeys/shopping-list.mobile.journey.ts",
        "e2e/journeys/sign-in.journey.ts",
      ],
      why: expect.stringContaining("runs 4 affected journey spec(s) and the HX census"),
    });
  });

  it("runs a changed spec without the census when no app code changed", () => {
    const decision = decide({ files: ["e2e/journeys/cookbooks.journey.ts"], labels: [], specs: SPECS });
    expect(decision).toMatchObject({ mode: "affected", census: false });
    expect(decision.specs).toEqual([
      "e2e/journeys/cookbooks.journey.ts",
      "e2e/journeys/round-trips.journey.ts",
      "e2e/journeys/sign-in.journey.ts",
    ]);
    expect(decision.why).not.toContain("census");
    expect(decision.why).toContain("Add the `visual` label");
  });

  it.each([
    ["the census journey", "e2e/journeys/hx-census.journey.ts"],
    ["the personas setup", "e2e/journeys/personas.setup.ts"],
    ["the journeys support code", "e2e/journeys/support/personas.ts"],
    ["the explore suite", "e2e/journeys/app.explore.ts"],
    ["a worker", "workers/cook-session.ts"],
    ["a migration", "migrations/0042_add_column.sql"],
  ])("runs the full suite when %s changes", (_name, file) => {
    expect(decide({ files: ["app/routes/home.tsx", file], labels: [], specs: SPECS }).mode).toBe("full");
  });

  it.each(["app/root.tsx", "app/routes.ts", "app/entry.client.tsx", "app/entry.server.tsx", "app/styles/tailwind.css"])(
    "runs the full suite when the app-wide %s changes",
    (file) => {
      const decision = decide({ files: [file], labels: [], specs: SPECS });
      expect(decision.mode).toBe("full");
      expect(decision.why).toBe(`\`${file}\` affects every page, so the full suite runs.`);
    },
  );

  it("runs the full suite when the specs could not be listed or none would run", () => {
    expect(decide({ files: ["app/routes/home.tsx"], labels: [] }).why).toContain("could not be listed");
    expect(decide({ files: ["app/routes/home.tsx"], labels: [], specs: ["e2e/journeys/personas.setup.ts"] }).why)
      .toContain("No journey spec matches");
  });

  it("runs the full suite when too many specs are affected", () => {
    const many = Array.from({ length: MAX_AFFECTED_SPECS + 1 }, (_, index) => `e2e/journeys/area-${index}.journey.ts`);
    const decision = decide({ files: many, labels: [], specs: many });
    expect(decision.mode).toBe("full");
    expect(decision.why).toContain(`more than ${MAX_AFFECTED_SPECS}`);
  });

  it("keeps the affected rules exactly as reviewed", () => {
    expect(AFFECTED_PATHS.map((pattern) => pattern.source)).toEqual(["^app\\/", "^stories\\/", "^public\\/"]);
    expect(APP_WIDE_PATHS.some((pattern) => pattern.test("app/routes/home.tsx"))).toBe(false);
    expect(SMOKE_SPECS).toEqual(["e2e/journeys/sign-in.journey.ts", "e2e/journeys/round-trips.journey.ts"]);
    expect(SPEC_FILE.test("e2e/journeys/cooking.mobile.journey.ts")).toBe(true);
    expect(SPEC_FILE.test("e2e/journeys/hx-census.journey.ts")).toBe(false);
    expect(SPEC_FILE.test("e2e/journeys/a b.journey.ts")).toBe(false);
    expect(SPEC_FILE.test("e2e/journeys/support/x.journey.ts")).toBe(false);
  });
});

describe("relatedSpecs", () => {
  it("ties app files to specs by a shared word of five or more letters, folding plurals", () => {
    const specs = ["e2e/journeys/cookbooks.journey.ts", "e2e/journeys/recipe-editing.journey.ts", "e2e/journeys/search.journey.ts"];
    expect(relatedSpecs(["app/routes/cookbook.$id.tsx", "app/lib/recipes.server.ts"], specs))
      .toEqual(["e2e/journeys/cookbooks.journey.ts", "e2e/journeys/recipe-editing.journey.ts"]);
  });

  it("ignores common path words and files outside app code", () => {
    const specs = ["e2e/journeys/round-trips.mobile.journey.ts", "e2e/journeys/search.journey.ts"];
    expect(relatedSpecs(["app/routes/index.tsx", "app/components/mobile/nav.tsx", "scripts/search.mjs"], specs)).toEqual([]);
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

  it("lists the head commit's journey specs", async () => {
    expect(await headJourneySpecs(githubRunner(), REPOSITORY, HEAD_SHA)).toEqual(SPECS);
  });

  it.each([
    ["not a list", JSON.stringify({ path: "e2e/journeys/a.journey.ts" })],
    ["an entry without a path", JSON.stringify([{ name: "a.journey.ts" }])],
    ["a null entry", JSON.stringify([null])],
  ])("rejects a journey spec list that is %s", async (_name, specs) => {
    await expect(headJourneySpecs(githubRunner({ specs }), REPOSITORY, HEAD_SHA)).rejects.toThrow(/spec list is malformed/);
  });
});

describe("runJourneysScope", () => {
  it("lets a documentation-only pull request skip the suite", async () => {
    const { decision, appendFile, summary } = await scope(scopeEnv(), githubRunner());
    expect(decision.journeys).toBe(false);
    expect(appendFile).toHaveBeenCalledWith(OUTPUT, "journeys=false\n");
    expect(appendFile).toHaveBeenCalledWith(OUTPUT, "mode=skip\n");
    expect(appendFile).toHaveBeenCalledWith(OUTPUT, "census=false\n");
    expect(appendFile).toHaveBeenCalledWith(OUTPUT, "specs=\n");
    expect(summary).toContain("### Journeys scope");
    expect(summary).toContain("The merge queue still runs it.");
  });

  it("writes the affected specs for an app change", async () => {
    const { decision, appendFile } = await scope(scopeEnv(), githubRunner({ files: [[{ filename: "app/routes/shopping-list.tsx" }]] }));
    expect(decision.mode).toBe("affected");
    expect(appendFile).toHaveBeenCalledWith(OUTPUT, "mode=affected\n");
    expect(appendFile).toHaveBeenCalledWith(OUTPUT, "census=true\n");
    expect(appendFile).toHaveBeenCalledWith(
      OUTPUT,
      "specs=e2e/journeys/round-trips.journey.ts e2e/journeys/shopping-list.journey.ts e2e/journeys/shopping-list.mobile.journey.ts e2e/journeys/sign-in.journey.ts\n",
    );
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
    ["a missing head SHA", scopeEnv({ HEAD_SHA: "" }), githubRunner(), "HEAD_SHA is required"],
    ["a malformed head SHA", scopeEnv({ HEAD_SHA: "main" }), githubRunner(), "must be a commit SHA"],
  ])("runs the suite on %s", async (_name, env, run, why) => {
    const { decision, appendFile, summary } = await scope(env, run as ReturnType<typeof githubRunner>);
    expect(decision.journeys).toBe(true);
    expect(appendFile).toHaveBeenCalledWith(OUTPUT, "journeys=true\n");
    expect(appendFile).toHaveBeenCalledWith(OUTPUT, "mode=full\n");
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
