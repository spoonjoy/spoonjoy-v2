import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { squircleCorners } from "../../app/lib/ouro/squircle-corners";
import { hasShapeVarSegment } from "./shape-var-segment";
import { readStylesheet } from "./theme-css";

const NOTCH = "shape(nonzero from 0 0, hline to 100%, vline to 100%, hline to 0, close, var(--sq-notch))";

describe("hasShapeVarSegment", () => {
  it("finds a var() that is a whole segment of a shape(), with or without a fallback", () => {
    expect(hasShapeVarSegment(NOTCH)).toBe(true);
    expect(hasShapeVarSegment("shape(from 0 0, close, var(--sq-notch, move to 0 0, close))")).toBe(true);
    expect(hasShapeVarSegment("shape(var(--start), close)")).toBe(true);
    expect(hasShapeVarSegment("inset(0) , shape(from 0 0, close, var(--x))")).toBe(true);
  });

  it("leaves a var() inside a segment, and values with no shape(), alone", () => {
    expect(hasShapeVarSegment("shape(from 0 0, hline to calc(100% - var(--a)), close)")).toBe(false);
    expect(hasShapeVarSegment("shape(from 0 0, hline to min(var(--a), var(--b)), close)")).toBe(false);
    expect(hasShapeVarSegment("inset(0 round var(--r))")).toBe(false);
    expect(hasShapeVarSegment("shape(from 0 0, close")).toBe(false);
  });
});

describe("Spoonjoy's built stylesheet", () => {
  it("has no var() segment in a shape() outside a custom property, so Chromium before 158 reads all of it", () => {
    // Ouro UI reads its notch and squircle shape() values back through custom properties since v1.3.520
    // (ourostack/ouro-ui#3491); this keeps an update or Spoonjoy's own CSS from bringing the bare form back.
    const out = postcss([squircleCorners()]).process(readStylesheet(), { from: undefined }).css;
    const offenders: string[] = [];
    postcss.parse(out).walkDecls((decl) => {
      if (!decl.prop.startsWith("--") && hasShapeVarSegment(decl.value)) offenders.push(`${decl.prop}: ${decl.value.slice(0, 60)}`);
    });
    expect(offenders).toEqual([]);
    expect(out).toContain("clip-path: var(--sq-clip)");
  });
});
