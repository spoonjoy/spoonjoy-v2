import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  filterViteBuildErrorOutput,
  shouldLogRollupBuildMessage,
  shouldLogViteBuildErrorMessage,
} from "../scripts/build-output-hygiene";

async function findSourceFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) return findSourceFiles(entryPath);
      if (entry.isFile() && /\.[tj]sx?$/.test(entry.name)) return [entryPath];
      return [];
    })
  );

  return files.flat();
}

describe("build output hygiene", () => {
  it("suppresses only Rollup empty-bundle diagnostics from route modules", () => {
    expect(shouldLogRollupBuildMessage("warn", {
      code: "EMPTY_BUNDLE",
      message: 'Generated an empty chunk: "api.v1._".',
      names: ["api.v1._"],
    })).toBe(false);
    expect(shouldLogRollupBuildMessage("warn", {
      code: "EMPTY_BUNDLE",
      message: 'Generated an empty chunk: "api.docs".',
      names: ["api.docs"],
    })).toBe(false);
    expect(shouldLogRollupBuildMessage("warn", {
      code: "EMPTY_BUNDLE",
      message: 'Generated an empty chunk: "api.openapi-json".',
    })).toBe(false);
    expect(shouldLogRollupBuildMessage("warn", {
      code: "EMPTY_BUNDLE",
      message: 'Generated an empty chunk: "oauth.revoke".',
    })).toBe(false);
    expect(shouldLogRollupBuildMessage("warn", {
      code: "EMPTY_BUNDLE",
      message: 'Generated an empty chunk: "sitemap.xml".',
    })).toBe(false);
    expect(shouldLogRollupBuildMessage("warn", {
      code: "EMPTY_BUNDLE",
      message: 'Generated an empty chunk: "robots.txt".',
    })).toBe(false);
    expect(shouldLogRollupBuildMessage("warn", {
      code: "EMPTY_BUNDLE",
      message: 'Generated an empty chunk: "csp-report".',
    })).toBe(false);
    expect(shouldLogRollupBuildMessage("warn", {
      code: "EMPTY_BUNDLE",
      message: 'Generated an empty chunk: "well-known.apple-app-site-association".',
    })).toBe(false);
    expect(shouldLogRollupBuildMessage("warn", {
      code: "EMPTY_BUNDLE",
      message: 'Generated an empty chunk: "accidental-client-entry".',
      names: ["accidental-client-entry"],
    })).toBe(true);
    expect(shouldLogRollupBuildMessage("warn", {
      code: "EMPTY_BUNDLE",
      message: 'Generated an empty chunk: "api.v1._".',
    })).toBe(false);
    expect(shouldLogRollupBuildMessage("warn", {
      code: "EMPTY_BUNDLE",
      message: "Generated an empty chunk without a quoted route name.",
    })).toBe(true);
    expect(shouldLogRollupBuildMessage("warn", {
      code: "EMPTY_BUNDLE",
    })).toBe(true);
    expect(shouldLogRollupBuildMessage("info", {
      code: "EMPTY_BUNDLE",
      message: 'Generated an empty chunk: "api.v1._".',
      names: ["api.v1._"],
    })).toBe(true);
    expect(shouldLogRollupBuildMessage("warn", {
      code: "UNRESOLVED_IMPORT",
      message: "Could not resolve import.",
    })).toBe(true);
  });

  it("suppresses only Vite's benign esbuild cancellation diagnostic", () => {
    expect(shouldLogViteBuildErrorMessage("✘ [ERROR] The build was canceled")).toBe(false);
    expect(shouldLogViteBuildErrorMessage("\u001b[31m✘ [ERROR] The build was canceled\u001b[39m")).toBe(false);
    expect(shouldLogViteBuildErrorMessage("✘ [ERROR] Could not resolve ./missing")).toBe(true);
    expect(shouldLogViteBuildErrorMessage("The build was canceled while compiling app code")).toBe(true);
  });

  it("filters benign Vite cancellation output while preserving surrounding build output", () => {
    expect(filterViteBuildErrorOutput([
      "rendering chunks...",
      "✘ [ERROR] The build was canceled",
      "computing gzip size...",
      "",
    ].join("\n"))).toBe("rendering chunks...\ncomputing gzip size...\n");
    expect(filterViteBuildErrorOutput("✘ [ERROR] Could not resolve ./missing\n")).toBe(
      "✘ [ERROR] Could not resolve ./missing\n"
    );
    expect(filterViteBuildErrorOutput("\n  \r\n\u001b[0m\n")).toBe("");
  });

  it("keeps inert client directives out of local app source", async () => {
    const sourceFiles = await findSourceFiles(path.join(process.cwd(), "app"));
    const filesWithClientDirective: string[] = [];

    await Promise.all(
      sourceFiles.map(async (filePath) => {
        const source = await readFile(filePath, "utf8");
        if (/^['\"]use client['\"];?\s*$/m.test(source)) {
          filesWithClientDirective.push(path.relative(process.cwd(), filePath));
        }
      })
    );

    expect(filesWithClientDirective).toEqual([]);
  });
});
