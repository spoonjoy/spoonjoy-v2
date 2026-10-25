// @vitest-environment node
// The journeys' accessibility gate (e2e/journeys/support/accessibility.ts) fails closed: every axe
// violation of any impact, every check axe could not decide, and every contrast measurement that
// fell short or could not be taken. The contrast arithmetic it judges with is
// e2e/journeys/support/contrast.ts.
import { describe, expect, it } from "vitest";
import type { NodeResult, Result } from "axe-core";
import { auditFailures, classifyAxeResults, describeAuditFailures, type SchemeAudit } from "../e2e/journeys/support/accessibility";
import {
  composite,
  contrastRatio,
  formatRatio,
  formatRgb,
  isLargeText,
  parseCssColor,
  relativeLuminance,
  requiredTextContrast,
  worstContrastOver,
} from "../e2e/journeys/support/contrast";

function node(target: NodeResult["target"], message = "", extra: Partial<NodeResult> = {}): NodeResult {
  return {
    html: "<p></p>",
    target,
    any: message ? [{ id: "check", impact: "serious", message, data: null, relatedNodes: [] }] : [],
    all: [],
    none: [],
    impact: "serious",
    ...extra,
  } as NodeResult;
}

function result(id: string, nodes: NodeResult[], impact: Result["impact"] = "minor"): Result {
  return { id, impact, help: `${id} help`, description: "", helpUrl: "", tags: [], nodes } as Result;
}

describe("contrast", () => {
  it("parses the colours browsers report", () => {
    expect(parseCssColor("rgb(31, 29, 26)")).toEqual({ r: 31, g: 29, b: 26, a: 1 });
    expect(parseCssColor("rgba(255, 255, 255, 0.5)")).toEqual({ r: 255, g: 255, b: 255, a: 0.5 });
    expect(parseCssColor("rgb(10 20 30 / 25%)")).toEqual({ r: 10, g: 20, b: 30, a: 0.25 });
    expect(parseCssColor("color(srgb 1 0 0.5 / 0.4)")).toEqual({ r: 255, g: 0, b: 127.5, a: 0.4 });
    expect(parseCssColor("color(srgb 1.2 -0.1 0)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(() => parseCssColor("oklch(0.5 0.1 30)")).toThrow(/Unknown colour format/);
  });

  it("computes WCAG luminance and contrast", () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1);
    expect(relativeLuminance({ r: 5, g: 5, b: 5 })).toBeCloseTo(0.0015, 4);
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21);
    expect(contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 })).toBeCloseTo(21);
    expect(contrastRatio({ r: 118, g: 118, b: 118 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(4.54, 2);
  });

  it("composites a translucent colour over what is behind it", () => {
    expect(composite({ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0 })).toEqual({ r: 127.5, g: 127.5, b: 127.5 });
    expect(composite({ r: 10, g: 20, b: 30, a: 1 }, { r: 200, g: 200, b: 200 })).toEqual({ r: 10, g: 20, b: 30 });
  });

  it("asks 3:1 of large text and 4.5:1 of the rest", () => {
    expect(isLargeText(24, 400)).toBe(true);
    expect(isLargeText(18.66, 700)).toBe(true);
    expect(isLargeText(18.66, 600)).toBe(false);
    expect(isLargeText(18, 700)).toBe(false);
    expect(requiredTextContrast(24, 400)).toBe(3);
    expect(requiredTextContrast(16, 700)).toBe(4.5);
  });

  it("keeps the worst pixel behind the text", () => {
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const pixels = new Uint8Array([0, 0, 0, 255, 200, 200, 200, 255, 20, 20, 20, 255]);
    const worst = worstContrastOver(white, pixels);
    expect(worst.background).toEqual({ r: 200, g: 200, b: 200 });
    expect(worst.ratio).toBeCloseTo(contrastRatio(white, { r: 200, g: 200, b: 200 }));
    expect(worst.pixels).toBe(3);
  });

  it("judges translucent text as painted over each pixel", () => {
    const halfWhite = { r: 255, g: 255, b: 255, a: 0.5 };
    const worst = worstContrastOver(halfWhite, new Uint8Array([0, 0, 0, 255]));
    expect(worst.ratio).toBeCloseTo(contrastRatio({ r: 127.5, g: 127.5, b: 127.5 }, { r: 0, g: 0, b: 0 }));
  });

  it("refuses to judge no pixels", () => {
    expect(() => worstContrastOver({ r: 0, g: 0, b: 0, a: 1 }, new Uint8Array([]))).toThrow(/Expected RGBA pixels, got 0 bytes/);
    expect(() => worstContrastOver({ r: 0, g: 0, b: 0, a: 1 }, new Uint8Array([1, 2, 3]))).toThrow(/got 3 bytes/);
  });

  it("prints colours and ratios without rounding a ratio up", () => {
    expect(formatRgb({ r: 127.5, g: 0.4, b: 255 })).toBe("rgb(128, 0, 255)");
    expect(formatRatio(4.499)).toBe("4.49:1");
    expect(formatRatio(21)).toBe("21.00:1");
  });
});

describe("classifyAxeResults", () => {
  it("keeps every violation, whatever its impact", () => {
    const { audit, contrastToMeasure } = classifyAxeResults("light", {
      violations: [result("heading-order", [node(["h3"], "Heading order invalid")], "moderate"), result("region", [node(["p"])], null)],
      incomplete: [],
    });
    expect(contrastToMeasure).toEqual([]);
    expect(audit.violations).toEqual([
      { rule: "heading-order", impact: "moderate", help: "heading-order help", target: "h3", message: "Heading order invalid" },
      { rule: "region", impact: "serious", help: "region help", target: "p", message: "" },
    ]);
  });

  it("sends undecided contrast to be measured and keeps every other undecided check as a failure", () => {
    const hero = node(["#hero > p"], "Element's background color could not be determined due to a background image");
    const { audit, contrastToMeasure } = classifyAxeResults("dark", {
      violations: [],
      incomplete: [result("color-contrast", [hero]), result("aria-valid-attr-value", [node([["iframe", "#x"]] as unknown as NodeResult["target"], "", { failureSummary: "Fix: id missing" })])],
    });
    expect(contrastToMeasure).toEqual([{ node: hero, axeReason: "Element's background color could not be determined due to a background image" }]);
    expect(audit.unresolved).toEqual([
      { rule: "aria-valid-attr-value", impact: "minor", help: "aria-valid-attr-value help", target: "iframe >>> #x", message: "Fix: id missing" },
    ]);
  });
});

describe("auditFailures", () => {
  const passing: SchemeAudit = {
    scheme: "light",
    violations: [],
    unresolved: [],
    contrast: [{ target: "#a", axeReason: "bg image", passed: true, ratio: 7.1, required: 4.5 }],
  };

  it("passes a page with no findings and only passing measurements", () => {
    expect(auditFailures(passing)).toEqual([]);
    expect(describeAuditFailures([passing, { ...passing, scheme: "dark" }])).toBeNull();
  });

  it("lists violations, undecided checks and failed or impossible measurements, per theme", () => {
    const failing: SchemeAudit = {
      scheme: "dark",
      violations: [
        { rule: "link-name", impact: null, help: "Links must have text", target: "a.x", message: "" },
        { rule: "list", impact: "serious", help: "", target: "ul", message: "List has a div" },
      ],
      unresolved: [
        { rule: "target-size", impact: "serious", help: "Targets are big enough", target: "button", message: "" },
        { rule: "aria-valid-attr-value", impact: "critical", help: "", target: "#y", message: "id missing" },
      ],
      contrast: [
        { target: "#hero h1", axeReason: "bg image", passed: false, ratio: 2.61, required: 4.5, textColor: "rgb(255, 255, 255)", worstBackground: "rgb(200, 190, 180)" },
        { target: "#hero p", axeReason: "bg gradient", passed: false, error: "line 1 is covered by div.scrim" },
        { target: "#ok", axeReason: "bg image", passed: true, ratio: 9, required: 4.5 },
      ],
    };
    expect(auditFailures(failing)).toEqual([
      "[dark] violation link-name (no impact): a.x: Links must have text",
      "[dark] violation list (serious): ul: List has a div",
      "[dark] unresolved target-size: button: Targets are big enough",
      "[dark] unresolved aria-valid-attr-value: #y: id missing",
      "[dark] color-contrast measured 2.61:1, needs 4.5:1: #hero h1: text rgb(255, 255, 255) over rgb(200, 190, 180) (axe: bg image)",
      "[dark] color-contrast could not be measured: #hero p: line 1 is covered by div.scrim (axe: bg gradient)",
    ]);
    expect(describeAuditFailures([passing, failing])).toBe(
      `Accessibility failures (6):\n${auditFailures(failing).map((line) => `  ${line}`).join("\n")}`,
    );
  });
});
