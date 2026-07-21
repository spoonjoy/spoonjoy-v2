import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type AllowlistEntry = {
  path: string;
  kind:
    | "historical-applied-migration"
    | "legacy-removal-migration"
    | "cleanup-target-definition"
    | "legacy-removal-contract-test";
  immutable: boolean;
  patterns: string[];
  reason: string;
  sha256: string;
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
  { id: "legacy-alex-email", regex: /\balex\.google@example\.com\b/i },
  { id: "legacy-alex-username", regex: /\balex_gourmet\b/i },
  { id: "legacy-alex-provider-id", regex: /\bgoogle_123456789\b/i },
  { id: "legacy-alex-provider-email", regex: /\balex\.google@gmail\.com\b/i },
  { id: "legacy-jamie-email", regex: /\bjamie\.apple@example\.com\b/i },
  { id: "legacy-jamie-username", regex: /\bjamie_kitchen\b/i },
  { id: "legacy-jamie-provider-id", regex: /\bapple_987654321\b/i },
  { id: "legacy-jamie-provider-email", regex: /\bjamie\.apple@icloud\.com\b/i },
  { id: "legacy-demo-user-id", regex: /\bdemo_user_001\b/ },
  { id: "legacy-primary-user-id", regex: /\buser_demo\b/ },
  { id: "legacy-julia-user-id", regex: /\buser_julia\b/ },
  { id: "legacy-marco-user-id", regex: /\buser_marco\b/ },
  { id: "legacy-sarah-user-id", regex: /\buser_sarah\b/ },
];

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

function readPolicyAllowlist(): AllowlistEntry[] {
  expect(existsSync(POLICY_ALLOWLIST_PATH), `${POLICY_ALLOWLIST_PATH} must quarantine immutable migration references`).toBe(
    true,
  );
  const parsed = JSON.parse(readFileSync(POLICY_ALLOWLIST_PATH, "utf8")) as AllowlistEntry[];
  for (const entry of parsed) {
    expect([
      "historical-applied-migration",
      "legacy-removal-migration",
      "cleanup-target-definition",
      "legacy-removal-contract-test",
    ]).toContain(entry.kind);
    expect(entry.reason).toMatch(/migration|cleanup/i);
    if (entry.kind.endsWith("migration")) {
      expect(entry.immutable).toBe(true);
      expect(entry.path).toMatch(/^migrations\/.*\.sql$/);
    } else if (entry.kind === "cleanup-target-definition") {
      expect(entry.immutable).toBe(false);
      expect(entry.path).toBe("scripts/cleanup-local-qa-data.mjs");
    } else {
      expect(entry.immutable).toBe(false);
      expect(entry.path).toBe("test/scripts/migration-0024-remove-legacy-demo-identities.test.ts");
    }
    expect(existsSync(entry.path), `${entry.path} must still exist`).toBe(true);
    expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(createHash("sha256").update(readFileSync(entry.path)).digest("hex")).toBe(entry.sha256);
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
  if (!stats.isFile()) return [];
  const source = readFileSync(startPath);
  if (source.includes(0)) return [];
  return [relative];
}

function collectTrackedSourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .filter((filePath) => !filePath.split(path.sep).some((part) => IGNORED_PATH_PARTS.has(part)))
    .filter((filePath) => existsSync(filePath) && statSync(filePath).isFile())
    .filter((filePath) => !readFileSync(filePath).includes(0))
    .sort();
}

function findForbiddenReferences(allowedPatterns: Map<string, Set<string>>) {
  return collectTrackedSourceFiles()
    .filter((filePath) => filePath !== path.join("test", "demo-source-policy.test.ts"))
    .flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return FORBIDDEN_DEMO_PATTERNS
        .filter((pattern) => pattern.regex.test(source))
        .filter((pattern) => !allowedPatterns.get(filePath)?.has(pattern.id))
        .map((pattern) => ({ filePath, patternId: pattern.id }));
    });
}

describe("demo-source policy", () => {
  it("quarantines immutable historical migration references instead of editing applied SQL", () => {
    const allowlist = readPolicyAllowlist();

    expect(allowlist.map((entry) => entry.path).sort()).toEqual([
      "migrations/0002_seed.sql",
      "migrations/0004_reseed.sql",
      "migrations/0024_remove_legacy_demo_identities.sql",
      "scripts/cleanup-local-qa-data.mjs",
      "test/scripts/migration-0024-remove-legacy-demo-identities.test.ts",
    ]);
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
    const allowedPatterns = new Map(
      readPolicyAllowlist().map((entry) => [entry.path, new Set(entry.patterns)]),
    );

    expect(findForbiddenReferences(allowedPatterns)).toEqual([]);
  });

  it("scans tracked env examples and extensionless text files", () => {
    expect(collectSourceFiles(".")).toContain(".env.example");

    const tempDir = mkdtempSync(".demo-source-policy-");
    const extensionlessPath = path.join(tempDir, "SOURCE");
    try {
      writeFileSync(extensionlessPath, "plain text source\n");
      expect(collectSourceFiles(tempDir)).toContain(extensionlessPath);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not inspect untracked local files that may contain secrets", () => {
    const tempDir = mkdtempSync(".demo-source-policy-untracked-");
    const untrackedPath = path.join(tempDir, ".env.local");
    try {
      writeFileSync(untrackedPath, "PRIVATE_TEST_VALUE=demo1234\n");
      expect(findForbiddenReferences(new Map())).not.toContainEqual({
        filePath: untrackedPath,
        patternId: "legacy-demo-password",
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
