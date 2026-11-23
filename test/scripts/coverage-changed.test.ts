import { describe, expect, it } from "vitest";
import { changedCoverageFiles, globToRegExp } from "../../scripts/coverage-changed.mjs";

describe("globToRegExp", () => {
  it("reads the coverage globs the way Vitest does", () => {
    expect(globToRegExp("app/lib/**/*.ts").test("app/lib/a.ts")).toBe(true);
    expect(globToRegExp("app/lib/**/*.ts").test("app/lib/x/y/a.ts")).toBe(true);
    expect(globToRegExp("app/lib/**/*.ts").test("app/lib/a.tsx")).toBe(false);
    expect(globToRegExp("app/lib/**/*.ts").test("app/libx/a.ts")).toBe(false);
    expect(globToRegExp("**/*.d.ts").test("app/types.d.ts")).toBe(true);
    expect(globToRegExp("test/**/*.{test,spec}.{ts,tsx}").test("test/a/b.spec.tsx")).toBe(true);
    expect(globToRegExp("scripts/test-changed.mjs").test("scripts/test-changedXmjs")).toBe(false);
    expect(globToRegExp("app/?.ts").test("app/a.ts")).toBe(true);
  });
});

describe("changedCoverageFiles", () => {
  const include = ["app/lib/**/*.ts", "scripts/check-journey-rules.mjs"];
  const exclude = ["**/*.d.ts", "app/lib/ouro/**"];
  const exists = (file: string) => file !== "app/lib/deleted.ts";

  it("keeps the changed files the full coverage run measures, and nothing else", () => {
    expect(changedCoverageFiles(
      ["app/lib/a.ts", "scripts/check-journey-rules.mjs", "README.md", "app/lib/types.d.ts", "app/lib/ouro/x.ts", "app/lib/deleted.ts"],
      { include, exclude, exists },
    )).toEqual(["app/lib/a.ts", "scripts/check-journey-rules.mjs"]);
  });

  it("reads a comma-separated list, as unit-changed passes it, and an empty one as none", () => {
    expect(changedCoverageFiles("app/lib/a.ts,,README.md", { include, exclude, exists })).toEqual(["app/lib/a.ts"]);
    expect(changedCoverageFiles(undefined, { include, exclude, exists })).toEqual([]);
  });

  it("checks the files on disk by default, so a deleted file is not measured", () => {
    expect(changedCoverageFiles(["scripts/coverage-changed.mjs", "scripts/no-such-file.mjs"], { include: ["scripts/*.mjs"], exclude: [] })).toEqual(["scripts/coverage-changed.mjs"]);
  });
});
