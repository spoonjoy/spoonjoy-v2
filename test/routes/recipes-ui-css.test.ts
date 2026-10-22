import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Unit 2.9a: UI/CSS Migration Tests
 *
 * These tests verify that all recipe CRUD components:
 * 1. Use Tailwind CSS classes instead of inline styles
 * 2. Use released UI and app-owned integration, never retired Catalyst imports
 *
 * Tests are expected to FAIL initially (TDD approach).
 * After migration (Unit 2.9b), all tests should pass.
 */

// Note: recipes.tsx is a simple layout route (just <Outlet />) that doesn't need UI imports
// so we exclude it from the UI import check but still include it for inline style checks
const RECIPE_ROUTE_FILES = [
  "app/routes/recipes.tsx",
  "app/routes/recipes._index.tsx",
  "app/routes/recipes.new.tsx",
  "app/routes/recipes.$id.tsx",
  "app/routes/recipes.$id.edit.tsx",
  "app/routes/recipes.$id.steps.new.tsx",
  "app/routes/recipes.$id.steps.$stepId.edit.tsx",
];

// Files that should have UI component imports (excludes layout-only routes and redirects)
const RECIPE_ROUTE_FILES_WITH_UI = [
  "app/routes/recipes.new.tsx",
  "app/routes/recipes.$id.tsx",
  "app/routes/recipes.$id.edit.tsx",
  "app/routes/recipes.$id.steps.new.tsx",
  "app/routes/recipes.$id.steps.$stepId.edit.tsx",
];

/**
 * Reads a source file and returns its content
 */
function readSourceFile(relativePath: string): string {
  const absolutePath = resolve(process.cwd(), relativePath);
  return readFileSync(absolutePath, "utf-8");
}

/**
 * Counts occurrences of inline style patterns in source code
 * Matches: style={{ ... }} and style={...}
 */
function countInlineStyles(content: string): number {
  // Match style={{ and style={expression}
  // This regex finds style= followed by { (object literal or expression)
  const inlineStylePattern = /style=\{/g;
  const matches = content.match(inlineStylePattern);
  return matches ? matches.length : 0;
}

/**
 * Checks the real released/app integration paths after complete Catalyst retirement.
 */
function hasUIComponentImports(content: string): boolean {
  return (
    content.includes('from "~/components/ouro/') ||
    content.includes("from '~/components/ouro/") ||
    content.includes('from "~/components/button"') ||
    content.includes('from "~/components/recipe/') ||
    content.includes('from "@/') ||
    content.includes("from '@/")
  );
}

/**
 * Checks if file uses raw button elements without using Button component
 * Note: Buttons inside hidden forms are excluded as they are not user-facing
 */
function usesRawButtonElements(content: string): boolean {
  // Has <button but doesn't import Button from UI
  const hasButtonElements = /<button\s/g.test(content);
  const importsButtonComponent =
    content.includes('import { Button') ||
    content.includes('import {Button') ||
    content.includes("Button }") ||
    content.includes("Button}") ||
    content.includes("RecipeBuilder"); // RecipeBuilder uses Button component internally

  // Check if the button is inside a hidden form (which is acceptable)
  const hasHiddenFormWithButton = /className="hidden"[^>]*>[^<]*<[^>]*button/gi.test(content);

  return hasButtonElements && !importsButtonComponent && !hasHiddenFormWithButton;
}

/**
 * How many raw <input> elements a chef can see. Hidden inputs carry form data and do not count.
 */
function countVisibleInputs(content: string): number {
  return (content.match(/<input\b(?!\s+type=["']hidden["'])/g) ?? []).length;
}

/**
 * The raw inputs each recipe route may keep. Every other field is one of Ouro UI's
 * (app/components/ouro/text-field/text-field.tsx).
 */
const ALLOWED_RAW_INPUTS: Record<string, number> = {
  // The image file input of the hidden form that carries RecipeBuilder's data to the action.
  "app/routes/recipes.new.tsx": 1,
  "app/routes/recipes.$id.edit.tsx": 1,
};

/**
 * How many raw <textarea> elements a chef can see. One with className="hidden" carries form data
 * and does not count.
 */
function countVisibleTextareas(content: string): number {
  return (content.match(/<textarea\b(?![^>]*className="hidden")/g) ?? []).length;
}

describe("Recipe Routes UI/CSS Compliance", () => {
  describe("No Inline Styles", () => {
    it.each(RECIPE_ROUTE_FILES)(
      "%s should have no inline styles (style={{}})",
      (filePath) => {
        const content = readSourceFile(filePath);
        const inlineStyleCount = countInlineStyles(content);

        expect(
          inlineStyleCount,
          `${filePath} has ${inlineStyleCount} inline style(s). ` +
          `All styling should use Tailwind CSS classes.`
        ).toBe(0);
      }
    );
  });

  describe("Uses UI Components", () => {
    it.each(RECIPE_ROUTE_FILES_WITH_UI)(
      "%s should import released UI or its app-owned integration",
      (filePath) => {
        const content = readSourceFile(filePath);

        expect(
          hasUIComponentImports(content),
          `${filePath} should import released UI or app-owned integration`
        ).toBe(true);
      }
    );
  });

  describe("Button Component Usage", () => {
    it.each(RECIPE_ROUTE_FILES)(
      "%s should use Button component instead of raw <button>",
      (filePath) => {
        const content = readSourceFile(filePath);

        expect(
          usesRawButtonElements(content),
          `${filePath} uses raw <button> elements. ` +
          `Should use released Button through app/components/button.tsx`
        ).toBe(false);
      }
    );
  });

  describe("Field Component Usage", () => {
    it("counts a raw input whatever else the file imports", () => {
      // The old check passed any file whose source had "Input }" in it, such as an import of
      // useUrlSyncedInput.
      expect(countVisibleInputs('import { useUrlSyncedInput } from "x";\n<input name="q" />')).toBe(1);
      expect(countVisibleInputs('<input type="hidden" name="a" />\n<input\n  type="hidden"\n  name="b"\n/>')).toBe(0);
      expect(countVisibleTextareas('<textarea name="d" className="hidden" />\n<textarea name="e" />')).toBe(1);
    });

    it.each(RECIPE_ROUTE_FILES)("%s uses Ouro UI's fields instead of raw <input>", (filePath) => {
      expect(
        countVisibleInputs(readSourceFile(filePath)),
        `${filePath} has a raw <input> that is not listed in ALLOWED_RAW_INPUTS. ` +
        `Use TextField from app/components/ouro/text-field/text-field.tsx`
      ).toBe(ALLOWED_RAW_INPUTS[filePath] ?? 0);
    });

    it.each(RECIPE_ROUTE_FILES)("%s uses Ouro UI's TextArea instead of raw <textarea>", (filePath) => {
      expect(
        countVisibleTextareas(readSourceFile(filePath)),
        `${filePath} has a raw <textarea>. Use TextArea from app/components/ouro/text-field/text-area.tsx`
      ).toBe(0);
    });
  });

  describe("Summary Report", () => {
    it("should generate a summary of all CSS/UI issues", () => {
      const issues: string[] = [];

      for (const filePath of RECIPE_ROUTE_FILES) {
        const content = readSourceFile(filePath);
        const fileIssues: string[] = [];

        const inlineStyleCount = countInlineStyles(content);
        if (inlineStyleCount > 0) {
          fileIssues.push(`${inlineStyleCount} inline style(s)`);
        }

        // Only check UI imports for files that should have them (exclude layout-only routes)
        if (RECIPE_ROUTE_FILES_WITH_UI.includes(filePath) && !hasUIComponentImports(content)) {
          fileIssues.push("no UI component imports");
        }

        if (usesRawButtonElements(content)) {
          fileIssues.push("uses raw <button>");
        }

        if (countVisibleInputs(content) !== (ALLOWED_RAW_INPUTS[filePath] ?? 0)) {
          fileIssues.push("uses raw <input>");
        }

        if (countVisibleTextareas(content) > 0) {
          fileIssues.push("uses raw <textarea>");
        }

        if (fileIssues.length > 0) {
          issues.push(`${filePath}: ${fileIssues.join(", ")}`);
        }
      }

      // This test will fail if there are any issues, listing them all
      expect(
        issues,
        `UI/CSS Migration Issues Found:\n${issues.join("\n")}`
      ).toHaveLength(0);
    });
  });
});

describe("Individual Route Detailed Checks", () => {
  describe("recipes.tsx (Layout Route)", () => {
    const filePath = "app/routes/recipes.tsx";

    it("should not use fontFamily inline style", () => {
      const content = readSourceFile(filePath);
      expect(content).not.toMatch(/fontFamily:/);
    });

    it("should not use padding inline style", () => {
      const content = readSourceFile(filePath);
      expect(content).not.toMatch(/padding:\s*["']?\d/);
    });

    it("should not use backgroundColor inline style", () => {
      const content = readSourceFile(filePath);
      expect(content).not.toMatch(/backgroundColor:/);
    });

    it("should not use borderRadius inline style", () => {
      const content = readSourceFile(filePath);
      expect(content).not.toMatch(/borderRadius:/);
    });
  });

  describe("recipes._index.tsx (Recipe List)", () => {
    const filePath = "app/routes/recipes._index.tsx";

    it("should not use gridTemplateColumns inline style", () => {
      const content = readSourceFile(filePath);
      expect(content).not.toMatch(/gridTemplateColumns:/);
    });

    it("should not use onMouseEnter/onMouseLeave for hover styles", () => {
      const content = readSourceFile(filePath);
      expect(content).not.toMatch(/onMouseEnter.*style/);
      expect(content).not.toMatch(/onMouseLeave.*style/);
    });
  });

  describe("recipes.new.tsx (Create Recipe Form)", () => {
    const filePath = "app/routes/recipes.new.tsx";

    it("should use Fieldset for form structure", () => {
      const content = readSourceFile(filePath);
      // RecipeBuilder component contains Fieldset internally
      expect(
        content.includes("Fieldset") || content.includes("fieldset") || content.includes("RecipeBuilder"),
        "Should use Fieldset component for form structure (or RecipeBuilder which contains it)"
      ).toBe(true);
    });

    it("should use Alert for error messages", () => {
      const content = readSourceFile(filePath);
      // RecipeBuilder component contains error handling internally
      expect(
        content.includes("Alert") || content.includes("alert") || content.includes("ValidationError") || content.includes("RecipeBuilder"),
        "Should use Alert or ValidationError component for error messages (or RecipeBuilder which handles them)"
      ).toBe(true);
    });
  });

  describe("recipes.$id.tsx (Recipe Detail)", () => {
    const filePath = "app/routes/recipes.$id.tsx";

    it("should use Ouro HX Heading for h1/h2", () => {
      const content = readSourceFile(filePath);
      expect(content, "Should use Ouro HX Heading for headings").toContain('from "~/components/ouro/text/heading"');
    });

    it("should use Text component for paragraphs", () => {
      const content = readSourceFile(filePath);
      expect(content, "Should use Ouro HX Text for paragraphs").toContain('from "~/components/ouro/text/text"');
    });
  });

  describe("recipes.$id.edit.tsx (Edit Recipe Form)", () => {
    const filePath = "app/routes/recipes.$id.edit.tsx";

    it("should not have more than 0 inline styles", () => {
      const content = readSourceFile(filePath);
      const count = countInlineStyles(content);
      expect(count).toBe(0);
    });
  });

  describe("recipes.$id.steps.new.tsx (Create Step Form)", () => {
    const filePath = "app/routes/recipes.$id.steps.new.tsx";

    it("should not have more than 0 inline styles", () => {
      const content = readSourceFile(filePath);
      const count = countInlineStyles(content);
      expect(count).toBe(0);
    });
  });

  describe("recipes.$id.steps.$stepId.edit.tsx (Edit Step Form)", () => {
    const filePath = "app/routes/recipes.$id.steps.$stepId.edit.tsx";

    it("should not have more than 0 inline styles", () => {
      const content = readSourceFile(filePath);
      const count = countInlineStyles(content);
      expect(count).toBe(0);
    });
  });
});
