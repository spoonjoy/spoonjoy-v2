import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { restates } from "../../scripts/lint/comments.mjs";

const dir = mkdtempSync(path.join(tmpdir(), "lint-comments-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Each hit of the comment rules in `code`, as "line rule", run by oxlint itself. */
function lint(code: string): string[] {
  const plugin = path.resolve("scripts/lint/comments.mjs");
  writeFileSync(path.join(dir, ".oxlintrc.json"), JSON.stringify({ jsPlugins: [plugin], rules: { "comments/no-orphan-doc": "error", "comments/no-restating-comment": "error" } }));
  writeFileSync(path.join(dir, "file.ts"), code);
  const result = spawnSync(path.resolve("node_modules/.bin/oxlint"), ["--format", "json", "-c", ".oxlintrc.json", "file.ts"], { cwd: dir, encoding: "utf8" });
  const { diagnostics } = JSON.parse(result.stdout) as { diagnostics: { code: string; message: string; labels: { span: { line: number } }[] }[] };
  return diagnostics.map((d) => `${d.labels[0].span.line} ${d.code}: ${d.message}`);
}

describe("scripts/lint/comments.mjs", () => {
  it("fails a doc block with another doc block directly after it, and names the fix", () => {
    const found = lint("/** Gone. */\n/** Kept. */\nexport const a = 1;\n\n/** A file note. */\n\n/** B. */\nexport const b = 2;\n");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^1 comments\(no-orphan-doc\): This doc block describes nothing/);
    expect(found[0]).toMatch(/Merge the two, move this one to the code it describes, or delete it\./);
  });

  it("fails a one-line comment that only restates the next lines, and names the fix", () => {
    const found = lint('export function f(intent: string) {\n  // Handle delete intent\n  if (intent === "delete") return 1;\n  return 0;\n}\n');
    expect(found).toEqual([
      "2 comments(no-restating-comment): This comment says what the next lines already say. Delete it, or say why the code does this or what it can't show.",
    ]);
  });

  it("passes a comment that says something the code does not, or sits with other comments", () => {
    expect(
      lint(
        [
          "export function f(code: string, items: string[]) {",
          "  // Check for unique constraint violation",
          '  if (code === "P2002") return 1;',
          "  // Create a soft-deleted recipe",
          "  items.push(code);",
          "  // Handle delete intent",
          "  // because the form posts it twice",
          '  if (code === "delete") return 2;',
          '  const x = 1; // Handle delete intent',
          '  if (code === "delete") return x;',
          "  return 0;",
          "}",
          "",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("reads a comment as restating only when every word past its verb is a small word or part of a name", () => {
    expect(restates(" Check if username exists", "export async function usernameExists(db, username) {")).toBe(true);
    expect(restates(" Create three steps", "await db.recipeStep.createMany({")).toBe(true);
    expect(restates(" Load step edit data", "const result = await loadStepEdit(recipeId, stepId);")).toBe(false);
    expect(restates(" Create OAuth-only user (no password)", "const oauthData = {")).toBe(false);
    expect(restates(" Handle delete intent.", 'if (intent === "delete") {')).toBe(false);
    expect(restates(" Delete step 2 first", "await deleteStep(recipeId, step2Id);")).toBe(false);
    expect(restates(" Remember the delete intent", 'if (intent === "delete") {')).toBe(false);
  });
});
