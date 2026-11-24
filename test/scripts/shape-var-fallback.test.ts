import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { hasShapeVarSegment, shapeVarFallback } from "../../scripts/shape-var-fallback.mjs";
import { squircleCorners } from "../../app/lib/ouro/squircle-corners";
import { readStylesheet } from "../styles/theme-css";

const NOTCH = "shape(nonzero from 0 0, hline to 100%, vline to 100%, hline to 0, close, var(--sq-notch))";

function run(css: string, plugins = [shapeVarFallback()]): string {
  return postcss(plugins).process(css, { from: undefined }).css;
}

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

describe("shapeVarFallback", () => {
  it("reads such a shape() through --sj-clip-path, which does not inherit, on the same rule", () => {
    const out = run(`[data-ouro-bite] { clip-path: ${NOTCH}; }`);
    expect(out).toMatch(/^@property --sj-clip-path \{\s*syntax: "\*";\s*inherits: false;?\s*\}/);
    expect(out).toContain(`[data-ouro-bite] { --sj-clip-path: ${NOTCH}; clip-path: var(--sj-clip-path); }`);
  });

  it("changes nothing when no clip-path has a var() segment", () => {
    const css = ".a { clip-path: inset(0 round var(--r)); } .b { clip-path: shape(from 0 0, hline to var(--w), close); }";
    expect(run(css)).toBe(css);
  });

  it("leaves no var() segment in a shape() in Spoonjoy's built stylesheet, ouro-base and squircleCorners() included", () => {
    const out = run(readStylesheet(), [squircleCorners(), shapeVarFallback()]);
    const root = postcss.parse(out);
    const offenders: string[] = [];
    root.walkDecls((decl) => {
      if (!decl.prop.startsWith("--") && hasShapeVarSegment(decl.value)) offenders.push(`${decl.prop}: ${decl.value.slice(0, 60)}`);
    });
    expect(offenders).toEqual([]);
    expect(out).toContain("clip-path: var(--sj-clip-path)");
  });
});
