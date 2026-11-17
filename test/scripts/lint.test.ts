import { describe, expect, it } from "vitest";
import { compare, countHits, rises, ruleOf } from "../../scripts/lint.mjs";

describe("scripts/lint.mjs", () => {
  it("names a hit by its rule, a stale disable comment, or else oxlint itself", () => {
    expect(ruleOf({ code: "eslint(no-unused-vars)", message: "x" })).toBe("eslint(no-unused-vars)");
    expect(ruleOf({ message: "Unused eslint-disable directive (no problems were reported)." })).toBe("unused-disable-directive");
    expect(ruleOf({ message: "Expected `;` but found `}`" })).toBe("oxlint");
  });

  it("counts hits per file and rule, in code-unit order", () => {
    expect(
      Object.keys(
        countHits([
          { filename: "b.ts", code: "r", message: "" },
          { filename: "B.ts", code: "r", message: "" },
          { filename: "b.ts", code: "r", message: "" },
        ]),
      ),
    ).toEqual(["B.ts", "b.ts"]);
    expect(countHits([{ filename: "b.ts", code: "r", message: "" }, { filename: "b.ts", code: "r", message: "" }])).toEqual({ "b.ts": { r: 2 } });
  });

  it("reports every count that differs from the baseline, rises and falls alike", () => {
    const baseline = { "a.ts": { r: 2 }, "gone.ts": { r: 1 } };
    const current = { "a.ts": { r: 3 }, "new.ts": { s: 1 } };
    expect(compare(baseline, current)).toEqual([
      { file: "a.ts", rule: "r", baseline: 2, now: 3 },
      { file: "gone.ts", rule: "r", baseline: 1, now: 0 },
      { file: "new.ts", rule: "s", baseline: 0, now: 1 },
    ]);
    expect(compare(baseline, baseline)).toEqual([]);
  });

  it("fails a rule whose total rose against the base, but lets a moved file keep its hits", () => {
    const base = { "old.ts": { r: 2 }, "a.ts": { s: 1 } };
    expect(rises(base, { "new.ts": { r: 2 }, "a.ts": { s: 1 } })).toEqual([]);
    expect(rises(base, { "old.ts": { r: 2 }, "a.ts": { s: 2, t: 1 } })).toEqual([
      { rule: "s", base: 1, now: 2 },
      { rule: "t", base: 0, now: 1 },
    ]);
  });
});
