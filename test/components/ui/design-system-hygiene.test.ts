import { readFileSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const APP_AND_STORY_FILES = [
  "app/components",
  "app/routes",
  "stories",
];

const FORM_PRIMITIVES = [
  "app/components/ui/checkbox.tsx",
  "app/components/ui/combobox.tsx",
  "app/components/ui/listbox.tsx",
  "app/components/ui/select.tsx",
  "app/components/ui/textarea.tsx",
];

function readSourceFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf-8");
}

function listTextFiles(dirs: string[]): string[] {
  const found: string[] = [];

  function walk(relativeDir: string) {
    for (const entry of readdirSync(resolve(process.cwd(), relativeDir))) {
      const relativePath = `${relativeDir}/${entry}`;
      const stat = statSync(resolve(process.cwd(), relativePath));
      if (stat.isDirectory()) {
        walk(relativePath);
      } else if (/\.(tsx?|jsx?)$/.test(entry)) {
        found.push(relativePath);
      }
    }
  }

  dirs.forEach(walk);
  return found;
}

describe("Spoonjoy UI design-system hygiene", () => {
  it.each(FORM_PRIMITIVES)("%s uses Spoonjoy radius tokens, not stale Catalyst radius math", (filePath) => {
    const content = readSourceFile(filePath);

    expect(content).not.toContain("calc(var(--radius-lg)-1px)");
    expect(content).not.toContain("rounded-lg");
    expect(content).not.toContain("rounded-xl");
    expect(content).toContain("var(--sj-radius-small)");
  });

  it("keeps button chrome flat enough to avoid doubled-button artifacts", () => {
    const content = readSourceFile("app/components/ui/button.tsx");

    expect(content).not.toContain("0_10px_24px");
    expect(content).toContain("shadow-none");
  });

  it("does not use negative letter spacing in app or story UI", () => {
    const offenders = listTextFiles(APP_AND_STORY_FILES).filter((filePath) =>
      readSourceFile(filePath).includes("tracking-[-"),
    );

    expect(offenders).toEqual([]);
  });

  it("does not use stale large-radius utility classes in app or story UI", () => {
    const staleRadiusPattern =
      /rounded-(?:lg|xl|2xl|3xl|md)|rounded-\[(?:1rem|1\.25rem|1\.6rem|2rem)\]|calc\(var\(--radius/;
    const offenders = listTextFiles(APP_AND_STORY_FILES).filter((filePath) =>
      staleRadiusPattern.test(readSourceFile(filePath)),
    );

    expect(offenders).toEqual([]);
  });
});
