import { afterEach, describe, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";
import { colorSchemeScript } from "~/lib/ouro/color-scheme-script";

const root = document.documentElement;
const run = (script: string) => new Function(script)() as void;

afterEach(async () => {
  vi.restoreAllMocks();
  localStorage.removeItem("ouro-color-scheme");
  localStorage.removeItem("app-theme");
  root.classList.remove("dark");
  root.style.colorScheme = "";
  await commands.emulateMedia({ colorScheme: "light" });
});

describe("colorSchemeScript", () => {
  it.each([
    ["dark", "light", true],
    ["light", "dark", false],
    ["system", "dark", true],
    ["system", "light", false],
  ] as const)("applies a kept %s choice with the system in %s", async (kept, system, dark) => {
    await commands.emulateMedia({ colorScheme: system });
    localStorage.setItem("ouro-color-scheme", kept);
    run(colorSchemeScript());
    expect(root.classList.contains("dark")).toBe(dark);
    expect(root.style.colorScheme).toBe(dark ? "dark" : "light");
  });

  it("falls back to the default scheme, the system's unless set, when nothing valid is kept", async () => {
    await commands.emulateMedia({ colorScheme: "dark" });
    run(colorSchemeScript());
    expect(root.classList.contains("dark")).toBe(true);
    localStorage.setItem("ouro-color-scheme", "sepia");
    run(colorSchemeScript({ defaultScheme: "light" }));
    expect(root.classList.contains("dark")).toBe(false);
  });

  it("reads the app's own key", () => {
    localStorage.setItem("app-theme", "dark");
    run(colorSchemeScript({ storageKey: "app-theme" }));
    expect(root.classList.contains("dark")).toBe(true);
    expect(colorSchemeScript({ storageKey: 'a"b' })).toContain('localStorage.getItem("a\\"b")');
  });

  it("uses the default when the browser refuses localStorage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    run(colorSchemeScript({ defaultScheme: "dark" }));
    expect(root.classList.contains("dark")).toBe(true);
  });
});
