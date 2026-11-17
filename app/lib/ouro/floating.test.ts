import { describe, expect, it } from "vitest";
import { floatingAlign, floatingHint, floatingMotionClass, floatingPlacementWarnings, floatingSide } from "~/lib/ouro/floating";

describe("floatingHint", () => {
  const hint = floatingHint('<Popover title="…">', "</Popover>");

  it("points a radius class at the theme radius", () => {
    expect(hint("rounded-ouro-xl")).toBe(":root { --radius: 0.75rem }");
  });

  it("wraps a text class around the body", () => {
    expect(hint("text-lg")).toBe('<Popover title="…"><div className="text-lg">…</div></Popover>');
  });

  it("points a color class at the popover colors", () => {
    expect(hint("bg-white")).toBe(":root { --popover: …; } .dark { --popover: …; }");
  });
});

describe("floatingMotionClass", () => {
  it("eases on the ease-out token, never ease-in, and grows from the trigger", () => {
    expect(floatingMotionClass).toContain("var(--ouro-ease-out)");
    expect(floatingMotionClass).not.toMatch(/ease-in|spring/);
    expect(floatingMotionClass).toContain("origin-(--transform-origin)");
    expect(floatingMotionClass).toContain("data-ending-style:duration-(--ouro-duration-fast)");
  });
});

describe("floatingSide and floatingAlign", () => {
  it("keep a side or alignment that is one of Ouro UI's, and fall back for any other", () => {
    expect(floatingSide("left", "bottom")).toBe("left");
    expect(floatingSide("start", "bottom")).toBe("bottom");
    expect(floatingAlign("end")).toBe("end");
    expect(floatingAlign("left")).toBe("center");
  });
});

describe("floatingPlacementWarnings", () => {
  it("names nothing for a known side and alignment and no placement", () => {
    expect(floatingPlacementWarnings("<Popover", "top", "bottom", "start", undefined)).toEqual([false, false, false]);
    expect(floatingPlacementWarnings("<Popover", undefined, "bottom", undefined, undefined)).toEqual([false, false, false]);
  });

  it("names an unknown side, an unknown alignment and a placement prop, each with the JSX that fixes it", () => {
    expect(floatingPlacementWarnings("<Popover", "up", "bottom", "left", "bottom-start")).toEqual([
      ['side="up" is not a side; use "top", "bottom", "left", "right"', '<Popover side="bottom">'],
      ['align="left" is not an alignment; use "start", "center", "end" (left is "start", right is "end")', '<Popover align="start">'],
      ["placement is not a prop; Ouro UI splits it into side and align", '<Popover side="bottom" align="start">'],
    ]);
  });
});
