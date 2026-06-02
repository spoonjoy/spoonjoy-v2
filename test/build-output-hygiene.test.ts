import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { shouldLogRollupBuildMessage } from "../scripts/build-output-hygiene";

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
      message: 'Generated an empty chunk: "accidental-client-entry".',
      names: ["accidental-client-entry"],
    })).toBe(true);
    expect(shouldLogRollupBuildMessage("warn", {
      code: "EMPTY_BUNDLE",
      message: 'Generated an empty chunk: "api.v1._".',
    })).toBe(false);
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
