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
});
