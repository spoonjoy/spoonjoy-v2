import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("local development seed policy", () => {
  const legacyDemoEmail = "demo@" + "spoonjoy.com";
  const legacyDemoPassword = "demo" + "1234";
  const reusableExamplePassword = "password" + "123";

  it("requires an explicit local target in package and CI seed calls", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");

    expect(packageJson.scripts["db:seed"]).toBe("pnpm exec tsx prisma/seed.ts --target-env local");
    expect(ciWorkflow).toContain("pnpm db:seed");
    expect(ciWorkflow).toContain("pnpm run cleanup:local:apply");
    expect(ciWorkflow).not.toMatch(/\bpnpm exec tsx prisma\/seed\.ts(?! --target-env local)/);
  });

  it("uses disposable generated local identities instead of reusable demo credentials", () => {
    const seedSource = readFileSync("prisma/seed.ts", "utf8");

    expect(seedSource).toContain("parseLocalSeedArgs");
    expect(seedSource).toContain("createDisposableLocalSeedRun");
    expect(seedSource).toContain("--target-env local");
    expect(seedSource).not.toContain(legacyDemoEmail);
    expect(seedSource).not.toContain(legacyDemoPassword);
    expect(seedSource).not.toContain(reusableExamplePassword);
  });
});
