import { readFileSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const APP_AND_STORY_FILES = [
  "app/components",
  "app/routes",
  "stories",
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
  it("spaces an Ouro UI field from its siblings with a gap, not a margin", () => {
    // Stopgap for the Ouro UI defect "a field's root sets m-0, which beats the margin space-y and
    // space-x put on children": the field touches what follows it. Remove with the fix (v0.8.0).
    const field = /^<(TextField|TextArea|Field|Select|Fieldset)\b/;
    const indentOf = (line: string) => line.length - line.trimStart().length;
    const offenders: string[] = [];

    for (const file of listTextFiles(APP_AND_STORY_FILES)) {
      if (file.startsWith("app/components/ouro/")) continue;
      const lines = readSourceFile(file).split("\n");
      lines.forEach((line, index) => {
        if (!/className=.*\bspace-[xy]-\d/.test(line)) return;
        // The element's direct children are the lines one step deeper, up to its closing tag.
        for (let next = index + 1; next < lines.length; next += 1) {
          const child = lines[next];
          if (child.trim() === "") continue;
          if (indentOf(child) <= indentOf(line)) break;
          if (indentOf(child) === indentOf(line) + 2 && field.test(child.trim())) {
            offenders.push(`${file}:${next + 1}`);
          }
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  it("keeps button chrome flat enough to avoid doubled-button artifacts", () => {
    const content = readSourceFile("app/components/ui/button.tsx");

    expect(content).not.toContain("0_10px_24px");
    expect(content).not.toContain("linear-gradient");
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
    // Ouro UI (app/components/ouro) is installed from its registry and keeps Tailwind's radius
    // names; tailwind.css derives those radii from Spoonjoy's control radius instead.
    const offenders = listTextFiles(APP_AND_STORY_FILES)
      .filter((filePath) => !filePath.startsWith("app/components/ouro/"))
      .filter((filePath) => staleRadiusPattern.test(readSourceFile(filePath)));

    expect(offenders).toEqual([]);
  });

  it("derives Ouro UI's radii from Spoonjoy's control radius", () => {
    const css = readSourceFile("app/styles/tailwind.css");

    expect(css).toContain("--radius: var(--sj-radius-control);");
    expect(css).toContain("--radius-xl: calc(var(--radius) * 1.4);");
  });

  it("keeps page mastheads from stacking a top rule under the desktop nav", () => {
    const css = readSourceFile("app/styles/tailwind.css");
    const kitchenRoute = readSourceFile("app/routes/_index.tsx");

    expect(css).not.toContain("border-block:");
    expect(css).toContain("border-bottom: 1px solid var(--sj-border-strong)");
    expect(kitchenRoute).not.toContain("border-y border-[var(--sj-border-strong)] py-7");
  });

  it("keeps Tailwind source discovery scoped to product UI files", () => {
    const css = readSourceFile("app/styles/tailwind.css");

    expect(css).toContain('@import "tailwindcss" source(none);');
    expect(css).toContain('@source "../**/*.{js,jsx,ts,tsx}";');
    expect(css).toContain('@source "../../stories/**/*.{js,jsx,ts,tsx,mdx}";');
    expect(css).not.toContain('@source "../../stories";');
  });

  it("keeps form and settings sections from echoing adjacent header rules", () => {
    const css = readSourceFile("app/styles/tailwind.css");
    const cookbookPage = readSourceFile("app/components/cookbook/page.tsx");
    const shoppingList = readSourceFile("app/routes/shopping-list.tsx");
    const stepNew = readSourceFile("app/routes/recipes.$id.steps.new.tsx");

    expect(css).not.toContain(".sj-form-section {\n  border");
    expect(cookbookPage).toContain('className="border-b border-[var(--sj-border)] py-6"');
    expect(cookbookPage).not.toContain('className="border-t border-[var(--sj-border)] py-6"');
    expect(shoppingList).not.toContain('<header className="border-b border-[var(--sj-border-strong)] pb-6">');
    expect(stepNew).not.toContain("Step Number:");
  });

  it("does not duplicate row dividers inside sj-list-ruled containers", () => {
    const offenders = listTextFiles(["app"]).flatMap((filePath) => {
      const content = readSourceFile(filePath);
      const findings: string[] = [];
      let searchFrom = 0;

      while (true) {
        const index = content.indexOf("sj-list-ruled", searchFrom);
        if (index === -1) break;
        const nearbyMarkup = content.slice(index, index + 900);
        if (nearbyMarkup.includes("border-b border-[var(--sj-border)]")) {
          findings.push(filePath);
        }
        searchFrom = index + "sj-list-ruled".length;
      }

      return findings;
    });

    expect([...new Set(offenders)]).toEqual([]);
  });
});
