import { describe, expect, it } from "vitest";
import { ariaKeyShortcuts } from "~/lib/ouro/key-shortcuts";

describe("ariaKeyShortcuts", () => {
  it("spells Kbd's key names as ARIA's key values", () => {
    expect(ariaKeyShortcuts(["alt", "up"])).toBe("Alt+ArrowUp");
    expect(ariaKeyShortcuts(["down"])).toBe("ArrowDown");
    expect(ariaKeyShortcuts(["arrowleft"])).toBe("ArrowLeft");
    expect(ariaKeyShortcuts(["right"])).toBe("ArrowRight");
    expect(ariaKeyShortcuts(["esc"])).toBe("Escape");
    expect(ariaKeyShortcuts(["escape"])).toBe("Escape");
    expect(ariaKeyShortcuts(["return"])).toBe("Enter");
    expect(ariaKeyShortcuts(["shift", "enter"])).toBe("Shift+Enter");
    expect(ariaKeyShortcuts(["space"])).toBe("Space");
    expect(ariaKeyShortcuts(["del"])).toBe("Delete");
    expect(ariaKeyShortcuts(["tab"])).toBe("Tab");
    expect(ariaKeyShortcuts(["backspace"])).toBe("Backspace");
  });

  it("lists mod both ways, upper-cases letters and keeps other characters", () => {
    expect(ariaKeyShortcuts(["mod", "shift", "e"])).toBe("Control+Shift+E Meta+Shift+E");
    expect(ariaKeyShortcuts(["cmd", "/"])).toBe("Meta+/");
    expect(ariaKeyShortcuts(["option", "control", "1"])).toBe("Alt+Control+1");
    expect(ariaKeyShortcuts(["f2"])).toBe("F2");
  });

  it.each([
    ["apple", "Meta+Shift+E"],
    ["windows", "Control+Shift+E"],
    ["other", "Control+Shift+E"],
  ] as const)("names mod as the platform's own modifier on %s", (platform, expected) => {
    expect(ariaKeyShortcuts(["mod", "shift", "e"], platform)).toBe(expected);
  });

  it("names mod both ways while the platform is unknown, as the server's HTML does", () => {
    expect(ariaKeyShortcuts(["mod", "shift", "e"], "unknown")).toBe("Control+Shift+E Meta+Shift+E");
  });

  it("spells the other keys the same on every platform", () => {
    expect(ariaKeyShortcuts(["cmd", "/"], "apple")).toBe("Meta+/");
    expect(ariaKeyShortcuts(["option", "control", "1"], "windows")).toBe("Alt+Control+1");
  });
});
