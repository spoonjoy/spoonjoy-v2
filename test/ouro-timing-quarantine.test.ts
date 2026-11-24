import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OURO_TIMING_QUARANTINE, ouroTimingTestNamePattern } from "./ouro/timing-quarantine";

const quarantined = OURO_TIMING_QUARANTINE.map(({ describe, test }) => `${describe} ${test}`);

describe("Ouro UI timing quarantine", () => {
  it("names tests that are still in Ouro UI's files", () => {
    for (const { file, describe: suite, test } of OURO_TIMING_QUARANTINE) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain(`describe(${JSON.stringify(suite)}`);
      expect(source, file).toContain(`it(${JSON.stringify(test)}`);
    }
  });

  it("leaves the quarantined tests out of the required run, and nothing else", () => {
    const required = ouroTimingTestNamePattern(undefined);
    for (const name of quarantined) expect(required.test(`app/components/ouro/x.test.tsx ${name}`), name).toBe(false);
    expect(required.test("Collapsible rotates the chevron while open")).toBe(true);
    expect(required.test("TextField's weight draws a plain field in no more than 6 elements and 15 components")).toBe(true);
    expect(required.test(`${quarantined[0]} and more`)).toBe(true);
  });

  it("runs only the quarantined tests in the timing run", () => {
    const only = ouroTimingTestNamePattern("only");
    for (const name of quarantined) expect(only.test(`app/components/ouro/x.test.tsx ${name}`), name).toBe(true);
    expect(only.test("Collapsible rotates the chevron while open")).toBe(false);
  });
});
