import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCRATCH_ACCOUNT_COUNT, SCRATCH_USER_COUNT } from "../../scripts/seed-qa-kitchen.mjs";
import { JOURNEY_SIGN_IN_ATTEMPTS, PERSONA_SIGN_INS, QA_SIGN_INS_PER_MINUTE } from "../../e2e/journeys/support/scratch-budget";

const SCRATCH_DIR = "e2e/journeys/scratch";

describe("the journeys' sign-in budget", () => {
  it("keeps a full run's sign-ins under three quarters of QA's limit a minute", () => {
    const total = PERSONA_SIGN_INS + SCRATCH_ACCOUNT_COUNT + JOURNEY_SIGN_IN_ATTEMPTS;
    expect(total).toBeLessThanOrEqual(QA_SIGN_INS_PER_MINUTE * 0.75);
  });

  it("signs in each scratch index's two accounts from its own file, and nothing else", () => {
    const files = readdirSync(SCRATCH_DIR).filter((name) => name.endsWith(".setup.ts")).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    expect(files).toHaveLength(SCRATCH_USER_COUNT);
    files.forEach((name, position) => {
      const n = position + 1;
      const source = readFileSync(`${SCRATCH_DIR}/${name}`, "utf8");
      expect(name.startsWith(`${n}-`)).toBe(true);
      expect(source.match(/^setup\(/gm)).toHaveLength(2);
      expect(source).toContain(`setup("scratch ${n}", async ({ page }) => {\n  await signInScratchAndSave(page, ${n});`);
      expect(source).toContain(`setup("scratch ${n} desktop", async ({ page }) => {\n  await signInScratchDesktopAndSave(page, ${n});`);
    });
  });
});
