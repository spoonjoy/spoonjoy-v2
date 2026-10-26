// @vitest-environment node
// The journeys' accessibility gate (e2e/journeys/support/accessibility.ts) fails closed: every axe
// violation of any impact, every check axe could not decide that no stronger measurement settled
// (e2e/journeys/support/undecided-checks.ts), and every contrast measurement that fell short or
// could not be taken. The contrast arithmetic it judges with is e2e/journeys/support/contrast.ts.
import { describe, expect, it } from "vitest";
import type { CheckResult, NodeResult, Result } from "axe-core";
import { auditFailures, classifyAxeResults, describeAuditFailures, type SchemeAudit } from "../e2e/journeys/support/accessibility";
import { planVerification } from "../e2e/journeys/support/undecided-checks";
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
    expect(() => parseCssColor("color(display-p3 1 0 0)")).toThrow(/Unknown colour format/);
  });

  it("parses OKLab and OKLCH colours into sRGB", () => {
    const close = (value: { r: number; g: number; b: number; a: number }, expected: [number, number, number, number]) => {
      expect(value.r).toBeCloseTo(expected[0], 0);
      expect(value.g).toBeCloseTo(expected[1], 0);
      expect(value.b).toBeCloseTo(expected[2], 0);
      expect(value.a).toBeCloseTo(expected[3], 5);
    };
    close(parseCssColor("oklab(1 0 0)"), [255, 255, 255, 1]);
    close(parseCssColor("oklab(0 0 0 / 0.1)"), [0, 0, 0, 0.1]);
    // CSS Color 4's sRGB red, in both forms.
    close(parseCssColor("oklab(0.627955 0.224863 0.125846)"), [255, 0, 0, 1]);
    close(parseCssColor("oklch(0.627955 0.257683 29.2339 / 50%)"), [255, 0, 0, 0.5]);
    close(parseCssColor("oklch(62.7955% 64.42% 29.2339)"), [255, 0, 0, 1]);
    close(parseCssColor("oklch(0.5 none none)"), [99, 99, 99, 1]);
    close(parseCssColor("oklab(0.5 none 0 / none)"), [99, 99, 99, 1]);
    // Outside sRGB: clipped to it, as painted.
    close(parseCssColor("oklch(0.9 0.4 145)"), [0, 255, 0, 1]);
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

  it("applies a faded ancestor's opacity once, not again over pixels it already faded", () => {
    // White text on a grey box at opacity 0.5 over black: the box paints rgb(64) and the text
    // rgb(127.5), 2.59:1. Fading the text colour over the already faded box would claim 3.92:1.
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const worst = worstContrastOver(white, new Uint8Array([64, 64, 64, 255]), { opacity: 0.5, unfaded: new Uint8Array([128, 128, 128, 255]) });
    expect(worst.ratio).toBeCloseTo(contrastRatio({ r: 127.5, g: 127.5, b: 127.5 }, { r: 64, g: 64, b: 64 }));
    expect(worst.ratio).toBeLessThan(3);
    expect(worst.background).toEqual({ r: 64, g: 64, b: 64 });
  });

  it("refuses unfaded pixels that do not match the painted ones", () => {
    const black = { r: 0, g: 0, b: 0, a: 1 };
    expect(() => worstContrastOver(black, new Uint8Array([1, 2, 3, 255]), { opacity: 0.5, unfaded: new Uint8Array([]) })).toThrow(/do not match/);
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
    const { audit, contrastToMeasure, toVerify } = classifyAxeResults("light", {
      violations: [result("heading-order", [node(["h3"], "Heading order invalid")], "moderate"), result("region", [node(["p"])], null)],
      incomplete: [],
    });
    expect(contrastToMeasure).toEqual([]);
    expect(toVerify).toEqual([]);
    expect(audit.violations).toEqual([
      { rule: "heading-order", impact: "moderate", help: "heading-order help", target: "h3", message: "Heading order invalid" },
      { rule: "region", impact: "serious", help: "region help", target: "p", message: "" },
    ]);
  });

  it("sends undecided contrast to be measured, other settleable checks to be verified, and keeps the rest as failures", () => {
    const hero = node(["#hero > p"], "Element's background color could not be determined due to a background image");
    const toggle = node(["#box"], "", { all: [check("no-implicit-explicit-label", "Check that the <label> does not need be part of the ARIA checkbox field's name")] });
    const { audit, contrastToMeasure, toVerify } = classifyAxeResults("dark", {
      violations: [],
      incomplete: [
        result("color-contrast", [hero]),
        result("aria-toggle-field-name", [toggle]),
        result("aria-valid-attr-value", [node([["iframe", "#x"]] as unknown as NodeResult["target"], "", { failureSummary: "Fix: id missing" })]),
      ],
    });
    expect(contrastToMeasure).toEqual([{ node: hero, axeReason: "Element's background color could not be determined due to a background image" }]);
    expect(toVerify).toEqual([
      {
        finding: {
          rule: "aria-toggle-field-name",
          impact: "minor",
          help: "aria-toggle-field-name help",
          target: "#box",
          message: "Check that the <label> does not need be part of the ARIA checkbox field's name",
        },
        verification: { kind: "toggle-label-text", selector: "#box", related: [] },
      },
    ]);
    expect(audit.unresolved).toEqual([
      { rule: "aria-valid-attr-value", impact: "minor", help: "aria-valid-attr-value help", target: "iframe >>> #x", message: "Fix: id missing" },
    ]);
    expect(audit.verified).toEqual([]);
  });
});

function check(id: string, message = "", extra: Partial<CheckResult> = {}): CheckResult {
  return { id, impact: "serious", message, data: null, relatedNodes: [], ...extra } as CheckResult;
}

describe("planVerification", () => {
  it("verifies a toggle's label text only for the label check", () => {
    expect(planVerification("aria-toggle-field-name", node(["#a"], "", { all: [check("no-implicit-explicit-label")] }))).toEqual({
      kind: "toggle-label-text",
      selector: "#a",
      related: [],
    });
    expect(planVerification("aria-toggle-field-name", node(["#a"], "something else"))).toBeNull();
  });

  it("verifies a popup trigger's aria-controls only when axe could not tell whether the popup exists", () => {
    const popup = check("aria-valid-attr-value", "", { data: { messageKey: "controlsWithinPopup", needsReview: 'aria-controls="x"' } });
    expect(planVerification("aria-valid-attr-value", node(["#t"], "", { all: [popup] }))).toEqual({ kind: "closed-popup-controls", selector: "#t", related: [] });
    const other = check("aria-valid-attr-value", "", { data: { messageKey: "noId" } });
    expect(planVerification("aria-valid-attr-value", node(["#t"], "", { all: [other] }))).toBeNull();
    expect(planVerification("aria-valid-attr-value", node(["#t"], "", { all: [check("aria-valid-attr-value")] }))).toBeNull();
    expect(planVerification("aria-valid-attr-value", node(["#t"]))).toBeNull();
  });

  it("verifies focus in a hidden region against every focusable element axe found there", () => {
    const related = (target: NodeResult["target"]) => ({ html: "", target });
    const modal = check("focusable-modal-open", "", { relatedNodes: [related(["#g1"]), related(["#g2"])] });
    const again = check("focusable-not-tabbable", "", { relatedNodes: [related(["#g2"])] });
    expect(planVerification("aria-hidden-focus", node(["#shell"], "", { all: [modal, again] }))).toEqual({
      kind: "hidden-focus",
      selector: "#shell",
      related: ["#g1", "#g2"],
    });
    expect(planVerification("aria-hidden-focus", node(["#shell"], "", { all: [check("focusable-modal-open")] }))).toBeNull();
    const framed = check("focusable-modal-open", "", { relatedNodes: [related([["iframe", "#g"]] as unknown as NodeResult["target"])] });
    expect(planVerification("aria-hidden-focus", node(["#shell"], "", { all: [framed] }))).toBeNull();
  });

  it("verifies where the name of a field with several labels comes from", () => {
    expect(planVerification("form-field-multiple-labels", node(["#f"], "Multiple label elements"))).toEqual({ kind: "labelledby-name", selector: "#f", related: [] });
  });

  it("has no stronger measurement for other rules or for elements in a frame", () => {
    expect(planVerification("label", node(["#f"], "Form element does not have an implicit (wrapped) <label>"))).toBeNull();
    expect(planVerification("aria-toggle-field-name", node([["iframe", "#a"]] as unknown as NodeResult["target"], "", { all: [check("no-implicit-explicit-label")] }))).toBeNull();
  });
});

describe("auditFailures", () => {
  const passing: SchemeAudit = {
    scheme: "light",
    violations: [],
    unresolved: [],
    contrast: [
      { target: "#a", axeReason: "bg image", passed: true, ratio: 7.1, required: 4.5 },
      { target: "#behind", axeReason: "bg image", passed: true, inactive: "behind div.backdrop, and hidden from assistive technology by div#shell" },
    ],
    verified: [{ rule: "aria-toggle-field-name", impact: "serious", help: "", target: "#box", message: "", measured: "all visible label text is in its name" }],
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
      verified: [],
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
