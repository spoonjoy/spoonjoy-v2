import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
      "brace-expansion@1": "1.1.18",
      "brace-expansion@2": "2.1.4",
      "dompurify": "3.4.13",
      "js-yaml@3": "3.15.1",
      "nanoid": "3.3.18",
      "undici": "7.29.0",
    });
    expect(packageJson.pnpm.patchedDependencies).toHaveProperty(
      "react-router@7.18.2",
      "patches/react-router@7.18.2.patch",
    );
    expect(existsSync(join(projectRoot, "patches/react-router@7.18.2.patch"))).toBe(true);
    expect(packageJson.pnpm.patchedDependencies).not.toHaveProperty("react-router@7.18.1");
  });

  it("keeps only exact short-lived reviewed tooling residuals", () => {
    expect(allowlist.allowedVulnerabilities).toHaveLength(4);
    expect(allowlist.allowedVulnerabilities.map((entry: { packageName: string }) => entry.packageName).sort())
      .toEqual(["deepmerge-ts", "effect", "esbuild", "uuid"]);
    for (const entry of allowlist.allowedVulnerabilities) {
      expect(entry.id).toMatch(/^GHSA-/);
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(entry.ecosystem).toBe("npm");
      expect(entry.reason).toMatch(/tooling-only/i);
      expect(entry.expiresOn).toBe("2026-09-18");
    }
  });
});
