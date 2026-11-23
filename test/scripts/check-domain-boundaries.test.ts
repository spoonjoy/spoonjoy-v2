import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTEXTS, findViolations, main } from "../../scripts/check-domain-boundaries.mjs";

const roots: string[] = [];

function repo(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "domain-boundaries-"));
  roots.push(root);
  for (const context of CONTEXTS) files[`app/domains/${context}/index.ts`] ??= "export {};\n";
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("scripts/check-domain-boundaries.mjs", () => {
  it("passes a layout that keeps the rule", () => {
    const root = repo({
      "app/domains/kitchen/model/recipe.ts": 'import Fraction from "fraction.js";\nimport { slug } from "./slug";\nimport { formatQuantity } from "~/domains/food-knowledge";\nexport type { Unit } from "../../food-knowledge/index";\n',
      "app/domains/kitchen/model/slug.ts": "export const slug = 1;\n",
      "app/domains/kitchen/application/save.ts": 'import { db } from "~/lib/db.server";\nimport { recipe } from "../model/recipe";\nimport { isFlagOn } from "~/domains/platform";\n',
      "app/domains/kitchen/model/recipe.test.ts": 'import { readFileSync } from "node:fs";\n',
      "app/routes/recipes.tsx": 'import { recipe } from "~/domains/kitchen";\nconst lazy = () => import("~/domains/cooking/index");\nimport { cloudflarePlatform, queueJobs } from "~/domains/platform/index.server";\n',
      "app/lib/readme.md": 'import x from "~/domains/kitchen/model/recipe";\n',
    });
    expect(findViolations(root)).toEqual([]);
  });

  it("fails a model that does I/O or reaches outside its context's model", () => {
    const root = repo({
      "app/domains/kitchen/model/recipe.ts": [
        'import { readFileSync } from "node:fs";',
        'import { PrismaClient } from "@prisma/client";',
        'import { useState } from "react";',
        'import { db } from "~/lib/db.server";',
        'import { save } from "../application/save";',
        'import { isFlagOn } from "~/domains/platform";',
        'import { env } from "cloudflare:workers";',
        'import path from "path";',
        'import { lookup } from "~/domains/food-knowledge/index.server";',
      ].join("\n"),
    });
    expect(findViolations(root).map((v) => v.specifier)).toEqual([
      "node:fs",
      "@prisma/client",
      "react",
      "~/lib/db.server",
      "../application/save",
      "~/domains/platform",
      "cloudflare:workers",
      "path",
      "~/domains/food-knowledge/index.server",
    ]);
    expect(findViolations(root)[0]).toMatchObject({ file: "app/domains/kitchen/model/recipe.ts", rule: "model-purity" });
  });

  it("fails any code that reaches into another context's internals", () => {
    const root = repo({
      "app/domains/kitchen/application/save.ts": 'export { x } from "~/domains/cooking/model/session";\n',
      "app/routes/cook.tsx": 'import { y } from "../domains/cooking/adapters/d1";\nimport z from "~/domains/cooking/model";\n',
      "app/domains/cooking/model/session.ts": 'import { a } from "../../kitchen/model/recipe";\n',
    });
    expect(findViolations(root)).toEqual([
      expect.objectContaining({ file: "app/domains/cooking/model/session.ts", specifier: "../../kitchen/model/recipe", rule: "context-internals" }),
      expect.objectContaining({ file: "app/domains/kitchen/application/save.ts", specifier: "~/domains/cooking/model/session", rule: "context-internals" }),
      expect.objectContaining({ file: "app/routes/cook.tsx", specifier: "../domains/cooking/adapters/d1", rule: "context-internals" }),
      expect.objectContaining({ file: "app/routes/cook.tsx", specifier: "~/domains/cooking/model", rule: "context-internals" }),
    ]);
  });

  it("fails a context without its index.ts, and a folder that is not a context", () => {
    const root = repo({ "app/domains/recipes/index.ts": "export {};\n" });
    rmSync(join(root, "app/domains/move-in/index.ts"));
    expect(findViolations(root)).toEqual([
      expect.objectContaining({ file: "app/domains/move-in/index.ts", rule: "context-index" }),
      expect.objectContaining({ file: "app/domains/recipes", rule: "unknown-context" }),
    ]);
  });

  it("fails every missing context in a repository with no app folder", () => {
    const root = mkdtempSync(join(tmpdir(), "domain-boundaries-"));
    roots.push(root);
    expect(findViolations(root).map((v) => v.file)).toEqual(CONTEXTS.map((context) => `app/domains/${context}/index.ts`));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main(["--root", root])).toBe(1);
    expect(log).toHaveBeenCalledWith("app/domains/kitchen/index.ts: a context needs an index.ts, its public surface.");
    log.mockRestore();
  });

  it("passes this repository", () => {
    const lines: string[] = [];
    expect(main([], { log: (line: string) => lines.push(line) })).toBe(0);
    expect(lines).toEqual([`domain boundaries: ${CONTEXTS.length} contexts, 0 violations.`]);
  });

  it("prints each violation with its fix and exits 1, or says it passed", () => {
    const lines: string[] = [];
    const bad = repo({ "app/routes/cook.tsx": 'import { y } from "~/domains/cooking/model/x";\n' });
    expect(main(["--root", bad], { log: (line: string) => lines.push(line) })).toBe(1);
    expect(lines.join("\n")).toContain('app/routes/cook.tsx imports "~/domains/cooking/model/x"');
    expect(lines.join("\n")).toContain('import from "~/domains/cooking"');

    lines.length = 0;
    expect(main(["--root", repo({})], { log: (line: string) => lines.push(line) })).toBe(0);
    expect(lines).toEqual([`domain boundaries: ${CONTEXTS.length} contexts, 0 violations.`]);
  });
});
