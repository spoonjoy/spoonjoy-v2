import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAdvisoryAllowlist } from "../scripts/advisory-scan";

const projectRoot = process.cwd();
const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const allowlist = JSON.parse(readFileSync(join(projectRoot, "security/advisory-allowlist.json"), "utf8"));

describe("dependency advisory refresh contract", () => {
  it("pins the conservative compatible direct dependency upgrades", () => {
    expect(packageJson.dependencies).toMatchObject({
      "@posthog/react": "1.10.4",
      "@react-router/cloudflare": "7.18.2",
      "@react-router/dev": "7.18.2",
      "@react-router/node": "7.18.2",
      "posthog-js": "1.418.10",
      "react-router": "7.18.2",
    });
    expect(packageJson.devDependencies).toMatchObject({
      "@storybook/addon-a11y": "10.2.10",
      "@storybook/addon-docs": "10.2.10",
      "@storybook/addon-onboarding": "10.2.10",
      "@storybook/addon-themes": "10.2.10",
      "@storybook/addon-vitest": "10.2.10",
      "@storybook/react-vite": "10.2.10",
      "happy-dom": "20.8.9",
      "storybook": "10.2.10",
      "vite": "7.3.5",
    });
  });

  it("uses exact defensive transitive overrides and the reviewed React Router patch", () => {
    expect(packageJson.pnpm.overrides).toMatchObject({
      "@babel/core": "7.29.7",
      "brace-expansion@1": "1.1.21",
      "brace-expansion@2": "2.1.7",
      "brace-expansion@5": "5.0.12",
      "defu": "6.1.5",
      "dompurify": "3.4.16",
      "form-data": "4.0.6",
      "joi@17": "17.13.8",
      "js-yaml@3": "3.15.2",
      "lodash": "4.18.0",
      "minimatch@3": "3.1.4",
      "minimatch@9": "9.0.7",
      "nanoid": "3.3.18",
      "picomatch@2": "2.3.2",
      "picomatch@4": "4.0.4",
      "rollup@4": "4.59.0",
      "source-map-js": "1.2.2",
      "undici": "7.29.1",
      "ws@8": "8.21.0",
    });
    expect(packageJson.pnpm.patchedDependencies).toHaveProperty(
      "react-router@7.18.2",
      "patches/react-router@7.18.2.patch",
    );
    expect(existsSync(join(projectRoot, "patches/react-router@7.18.2.patch"))).toBe(true);
    const reactRouterPatch = readFileSync(join(projectRoot, "patches/react-router@7.18.2.patch"), "utf8");
    expect(reactRouterPatch.match(/\+\s+suppressHydrationWarning: true/g)).toHaveLength(6);
    expect(packageJson.pnpm.patchedDependencies).not.toHaveProperty("react-router@7.18.1");
  });

  it("keeps the allowlist well-formed, unexpired and short-lived", async () => {
    const now = new Date();
    // The scanner's own loader rejects malformed, broad, package-less, version-less and expired entries.
    const validated = await loadAdvisoryAllowlist(join(projectRoot, "security/advisory-allowlist.json"), now);
    expect(validated.allowedVulnerabilities).toHaveLength(allowlist.allowedVulnerabilities.length);
    const horizonMs = 45 * 24 * 60 * 60 * 1000;
    for (const entry of allowlist.allowedVulnerabilities) {
      expect(entry.id).toMatch(/^(GHSA|CVE|OSV)-/);
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(entry.ecosystem).toBe("npm");
      expect(entry.reason).toMatch(/tooling-only/i);
      const expiresAt = Date.parse(`${entry.expiresOn}T23:59:59Z`);
      expect(expiresAt).toBeGreaterThan(now.getTime());
      expect(expiresAt - now.getTime()).toBeLessThanOrEqual(horizonMs);
    }
  });

  it("the loader rejects an expired entry so a lapsed exception cannot pass silently", async () => {
    const dir = mkdtempSync(join(tmpdir(), "advisory-allowlist-"));
    const file = join(dir, "allowlist.json");
    const entry = {
      id: "GHSA-aaaa-bbbb-cccc",
      packageName: "example",
      version: "1.0.0",
      ecosystem: "npm",
      reason: "Tooling-only residual used by this test",
      expiresOn: "2020-01-01",
    };
    writeFileSync(file, JSON.stringify({ allowedVulnerabilities: [entry] }));
    await expect(loadAdvisoryAllowlist(file, new Date())).rejects.toThrow(/expired/);
    writeFileSync(file, JSON.stringify({ allowedVulnerabilities: [{ ...entry, expiresOn: "2999-01-01" }] }));
    await expect(loadAdvisoryAllowlist(file, new Date())).resolves.toBeDefined();
  });
});
