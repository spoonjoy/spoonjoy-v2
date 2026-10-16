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
  it("suppresses Rollup's notices about the client directive only for Ouro UI's copied-in files", () => {
    const ouroFile = path.join(process.cwd(), "app/components/ouro/form/form.tsx");
    const ouroLib = path.join(process.cwd(), "app/lib/ouro/ouro-provider.tsx");
    const ownFile = path.join(process.cwd(), "app/components/recipe/RecipeBuilder.tsx");
    const directive = {
      code: "MODULE_LEVEL_DIRECTIVE",
      message: 'Module level directives cause errors when bundled, "use client" in "app/components/ouro/form/form.tsx" was ignored.',
    };
    const sourcemap = {
      code: "SOURCEMAP_ERROR",
      message: "Error when using sourcemap for reporting an error: Can't resolve original location of error.",
      loc: { line: 1, column: 0 },
    };

    expect(shouldLogRollupBuildMessage("warn", { ...directive, id: ouroFile })).toBe(false);
    expect(shouldLogRollupBuildMessage("warn", { ...sourcemap, id: ouroFile })).toBe(false);
    expect(shouldLogRollupBuildMessage("warn", { ...sourcemap, id: ouroLib })).toBe(false);
    expect(shouldLogRollupBuildMessage("warn", { ...sourcemap, id: ouroFile.replaceAll("/", "\\") })).toBe(false);

    // Spoonjoy's own files, other directives, other lines and other levels still report.
    expect(shouldLogRollupBuildMessage("warn", { ...directive, id: ownFile })).toBe(true);
    expect(shouldLogRollupBuildMessage("warn", { ...sourcemap, id: ownFile })).toBe(true);
    expect(shouldLogRollupBuildMessage("warn", { ...directive })).toBe(true);
    expect(shouldLogRollupBuildMessage("warn", { code: "MODULE_LEVEL_DIRECTIVE", id: ouroFile })).toBe(true);
    expect(shouldLogRollupBuildMessage("warn", { ...directive, message: directive.message.replace("use client", "use server"), id: ouroFile })).toBe(true);
    expect(shouldLogRollupBuildMessage("warn", { ...sourcemap, loc: { line: 40, column: 2 }, id: ouroFile })).toBe(true);
    expect(shouldLogRollupBuildMessage("warn", { code: "SOURCEMAP_ERROR", id: ouroFile })).toBe(true);
    expect(shouldLogRollupBuildMessage("warn", { code: "CIRCULAR_DEPENDENCY", id: ouroFile })).toBe(true);
    expect(shouldLogRollupBuildMessage("info", { ...directive, id: ouroFile })).toBe(true);
  });

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
      message: 'Generated an empty chunk: "account.export".',
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
    // Stopgap for the Ouro UI defect "shadcn's installer does not strip Ouro UI's `"use client";`
    // line for an app that is not on React Server Components": every copied-in Ouro UI file
    // keeps the line, so only Spoonjoy's own source is held to this. The build's notices about
    // those files are filtered by scripts/build-output-hygiene.ts, under the same defect. Remove
    // both only when a pinned CLI install actually strips them. v0.8.0 installed via
    // shadcn 4.21.1 and 4.21.4 still retains these directives in this React Router app.
    const ouroDirs = ["app/components/ouro", "app/lib/ouro"].map((dir) => path.join(process.cwd(), dir) + path.sep);
    const sourceFiles = (await findSourceFiles(path.join(process.cwd(), "app"))).filter(
      (filePath) => !ouroDirs.some((dir) => filePath.startsWith(dir)),
    );
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
