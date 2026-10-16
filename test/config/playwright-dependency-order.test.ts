import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CI Playwright dependency verification", () => {
  it("installs the real system dependencies before checking them, then installs Chromium", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const step = workflow.split("      - name: 🎭 Install Playwright Browsers\n")[1]?.split("\n      - name:")[0];
    expect(step).toBeDefined();
    const lines = step!.split("\n").map((line) => line.trim());
    const install = lines.findIndex((line) => line.includes("apt-get -o Dpkg::Use-Pty=0 install -y --no-install-recommends"));
    const verify = lines.indexOf("node scripts/warning-gate.ts -- pnpm exec playwright install-deps --dry-run chromium");
    const browser = lines.indexOf("node scripts/warning-gate.ts -- pnpm exec playwright install chromium");
    expect(install).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(install);
    expect(browser).toBeGreaterThan(verify);
    expect(step).not.toMatch(/continue-on-error:|if:\s*false|\|\|\s*(?:true|:)|set \+e/);
  });
});
