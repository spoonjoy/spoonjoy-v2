import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { Button } from "~/components/button";

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

// Every file the HX CLI installs, with the SHA-256 of the v1.2.0 tag's bytes (tag commit
// 96542d72b60b436dd6a60447d888a4c9e9d5edf7), whatever its extension or folder: components, lib
// modules, specs, the census and source-rule kits and the claims checker. The CLI's binding
// (.github/task21-v083-cli.mjs) checks the CLI's output against this same map, and the digest
// below pins the map itself, so neither an installed file nor its recorded hash can change here.
const installed = JSON.parse(readSourceFile(".github/ouro-hx-installed.json")) as {
  tag: string;
  tagCommit: string;
  files: Record<string, string>;
};
const installedFiles = Object.keys(installed.files).sort();
// Spoonjoy's own files inside the folders HX installs into.
const SPOONJOY_FILES_IN_HX_FOLDERS = ["e2e/ouro-census/census.baseline.json"];
const HX_FOLDERS = ["app/components/ouro", "app/lib/ouro", "e2e/ouro", "e2e/ouro-census"];
const publishedPaths = new Set(installedFiles);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
// The CLI rewrites HX's registry aliases to the app's; this reverses only that.
const normalizedRegistrySource = (source: string) => source
  .replaceAll("~/components/ouro/", "@/registry/ouro/components/ouro/")
  .replaceAll("~/lib/ouro/", "@/registry/ouro/lib/ouro/");
function listAllFiles(dirs: string[]): string[] {
  const found: string[] = [];
  function walk(relativeDir: string) {
    for (const entry of readdirSync(resolve(process.cwd(), relativeDir))) {
      const relativePath = `${relativeDir}/${entry}`;
      if (statSync(resolve(process.cwd(), relativePath)).isDirectory()) walk(relativePath);
      else found.push(relativePath);
    }
  }
  dirs.forEach(walk);
  return found;
}
function hasAppTrackingViolation(file: string, source: string) {
  return !publishedPaths.has(file) && source.includes("tracking-[-");
}

describe("Spoonjoy UI design-system hygiene", () => {
  it("does not ship or hide the retired Catalyst source directory", () => {
    expect(existsSync(resolve(process.cwd(), "app/components/ui"))).toBe(false);
  });
  it("pins every file the HX CLI installed, in every folder and of every type, to the tag's bytes", () => {
    expect(installed.tag).toBe("v1.2.0");
    expect(installedFiles).toHaveLength(547);
    expect(sha256(JSON.stringify(installedFiles.map((file) => [file, installed.files[file]]))))
      .toBe("0483e65796100b0cc2fb58ac2abb34c2abd5e04120fc36b724e68f94c47b0a8f");
    const actual = Object.fromEntries(installedFiles.map((file) => [
      file,
      existsSync(resolve(process.cwd(), file)) ? sha256(normalizedRegistrySource(readSourceFile(file))) : null,
    ]));
    expect(actual).toEqual(installed.files);
  });

  it("keeps no unpinned file in the folders HX installs into", () => {
    const unpinned = listAllFiles(HX_FOLDERS)
      .filter((file) => !publishedPaths.has(file) && !SPOONJOY_FILES_IN_HX_FOLDERS.includes(file));
    expect(unpinned).toEqual([]);
  });

  it("rejects prohibited app-authored tracking even under a registry-looking prefix", () => {
    const source = '<h1 className="tracking-[-0.5em]">App copy</h1>';
    expect(hasAppTrackingViolation("app/components/heading.tsx", source)).toBe(true);
    expect(hasAppTrackingViolation("stories/App.stories.tsx", source)).toBe(true);
    expect(hasAppTrackingViolation("app/components/ouro/unpublished-app-copy.tsx", source)).toBe(true);
    expect(hasAppTrackingViolation("app/routes/recipes.tsx", '<h1 className="tracking-normal">Copy</h1>')).toBe(false);
  });
  it("uses one text link, Ouro UI's, outside the exact published inventory", () => {
    // The retired TextLink looked different: tomato and semibold rather than the
    // released Link's primary colour and normal weight.
    const offenders = listTextFiles(APP_AND_STORY_FILES)
      .filter((file) => !publishedPaths.has(file))
      .filter((file) => /\bTextLink\b/.test(readSourceFile(file)));

    expect(offenders).toEqual([]);
  });

  it("spaces an Ouro UI field from its siblings with a gap, not a margin", () => {
    // Stopgap for the Ouro UI defect "a field's root sets m-0, which beats the margin space-y and
    // space-x put on children": the field touches what follows it. Remove with the fix (v0.8.0).
    const field = /^<(TextField|TextArea|Field|Select|Fieldset)\b/;
    const indentOf = (line: string) => line.length - line.trimStart().length;
    const offenders: string[] = [];

    for (const file of listTextFiles(APP_AND_STORY_FILES)) {
      if (publishedPaths.has(file)) continue;
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
    render(createElement(Button, { children: "Flat action" }));
    const button = screen.getByRole("button", { name: "Flat action" });
    expect(button).toHaveAttribute("data-ouro", "button");
    expect(button.className).not.toMatch(/0_10px_24px|linear-gradient|(?:^|\s)shadow(?:-|\s)/);
  });

  it("does not use negative letter spacing in app or story UI", () => {
    // App-authored typography keeps its rule. Published Heading's tighter large
    // type is intentional (design-feel Type rule16), with exact provenance checked above.
    const offenders = listTextFiles(APP_AND_STORY_FILES)
      .filter((filePath) => hasAppTrackingViolation(filePath, readSourceFile(filePath)));

    expect(offenders).toEqual([]);
  });

  it("does not use stale large-radius utility classes in app or story UI", () => {
    const staleRadiusPattern =
      /rounded-(?:lg|xl|2xl|3xl|md)|rounded-\[(?:1rem|1\.25rem|1\.6rem|2rem)\]|calc\(var\(--radius/;
    // Ouro UI (app/components/ouro) is installed from its registry and keeps Tailwind's radius
    // names; tailwind.css derives those radii from Spoonjoy's control radius instead.
    const offenders = listTextFiles(APP_AND_STORY_FILES)
      .filter((filePath) => !publishedPaths.has(filePath))
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
