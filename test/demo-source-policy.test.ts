import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type AllowlistEntry = {
  path: string;
  kind: "historical-applied-migration";
  immutable: true;
  patterns: string[];
  reason: string;
};

const POLICY_ALLOWLIST_PATH = "docs/security/historical-demo-source-allowlist.json";

const FORBIDDEN_DEMO_PATTERNS = [
  { id: "legacy-demo-email", regex: /\bdemo@spoonjoy\.com\b/i },
  { id: "legacy-demo-password", regex: /\bdemo1234\b/i },
  { id: "reusable-example-password", regex: /\bpassword123\b/i },
  { id: "fixed-qa-demo-namespace", regex: /\bsj-qa-demo(?:[-_a-z0-9]*)?\b/i },
  { id: "legacy-primary-username", regex: /\bdemo_chef\b/i },
  { id: "legacy-julia-email", regex: /\bchef\.julia@example\.com\b/i },
  { id: "legacy-secondary-username", regex: /\bchef_julia\b/i },
  { id: "legacy-marco-email", regex: /\bmarco\.rossi@example\.com\b/i },
  { id: "legacy-marco-username", regex: /\bmarco_rossi\b/i },
  { id: "legacy-sarah-email", regex: /\bsarah\.chen@example\.com\b/i },
  { id: "legacy-sarah-username", regex: /\bsarah_chen\b/i },
];

const SOURCE_ROOTS = ["."];

const IGNORED_PATH_PARTS = new Set([
  ".git",
  ".cache",
  ".playwright",
  ".react-router",
  ".vite",
  ".wrangler",
  "build",
  "coverage",
  "node_modules",
  "playwright-report",
  "storybook-static",
  "test-results",
]);

const SCANNED_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".log",
  ".md",
  ".mjs",
  ".sh",
  ".sql",
  ".swift",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

function readPolicyAllowlist(): AllowlistEntry[] {
  expect(existsSync(POLICY_ALLOWLIST_PATH), `${POLICY_ALLOWLIST_PATH} must quarantine immutable migration references`).toBe(
    true,
  );
  const parsed = JSON.parse(readFileSync(POLICY_ALLOWLIST_PATH, "utf8")) as AllowlistEntry[];
  for (const entry of parsed) {
    expect(entry.kind).toBe("historical-applied-migration");
    expect(entry.immutable).toBe(true);
    expect(entry.reason).toMatch(/applied migration/i);
    expect(entry.path).toMatch(/^migrations\/.*\.sql$/);
    expect(existsSync(entry.path), `${entry.path} must still exist`).toBe(true);
  }
  return parsed;
}

function collectSourceFiles(startPath: string): string[] {
  if (!existsSync(startPath)) return [];
  const relative = path.relative(process.cwd(), startPath);
  if (relative.split(path.sep).some((part) => IGNORED_PATH_PARTS.has(part))) return [];
  const stats = statSync(startPath);
  if (stats.isDirectory()) {
    return readdirSync(startPath)
      .flatMap((entry) => collectSourceFiles(path.join(startPath, entry)))
      .sort();
  }
  if (!stats.isFile() || !SCANNED_EXTENSIONS.has(path.extname(startPath))) return [];
  return [relative];
}

function findForbiddenReferences(allowedPaths: Set<string>) {
  return SOURCE_ROOTS.flatMap((root) => collectSourceFiles(root))
    .filter((filePath) => filePath !== path.join("test", "demo-source-policy.test.ts"))
    .flatMap((filePath) => {
      if (allowedPaths.has(filePath)) return [];
      const source = readFileSync(filePath, "utf8");
      return FORBIDDEN_DEMO_PATTERNS.filter((pattern) => pattern.regex.test(source)).map((pattern) => ({
        filePath,
        patternId: pattern.id,
      }));
    });
}

describe("demo-source policy", () => {
  it("quarantines immutable historical migration references instead of editing applied SQL", () => {
    const allowlist = readPolicyAllowlist();

    expect(allowlist.map((entry) => entry.path).sort()).toEqual(["migrations/0002_seed.sql", "migrations/0004_reseed.sql"]);
    for (const entry of allowlist) {
      const source = readFileSync(entry.path, "utf8");
      const matchingPatternIds = FORBIDDEN_DEMO_PATTERNS
        .filter((pattern) => pattern.regex.test(source))
        .map((pattern) => pattern.id)
        .sort();
      expect(entry.patterns.toSorted(), `${entry.path} must declare every quarantined pattern`).toEqual(
        matchingPatternIds,
      );
      for (const patternId of entry.patterns) {
        const pattern = FORBIDDEN_DEMO_PATTERNS.find((candidate) => candidate.id === patternId);
        expect(pattern, `${entry.path} references unknown policy pattern ${patternId}`).toBeDefined();
        expect(source, `${entry.path} should explain why ${patternId} is quarantined`).toMatch(pattern!.regex);
      }
    }
  });

  it("keeps the complete active source tree free of fixed demo identities", () => {
    const allowedPaths = new Set(readPolicyAllowlist().map((entry) => entry.path));

    expect(findForbiddenReferences(allowedPaths)).toEqual([]);
  });
});
