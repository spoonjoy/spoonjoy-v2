import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { ColorSchemeToggle } from "~/components/ouro/color-scheme-toggle/color-scheme-toggle";
import { ColorSchemeProvider } from "~/lib/ouro/color-scheme";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
let mounted: Element[] = [];
const html = document.documentElement;

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    get toggle() {
      return host.querySelector<HTMLElement>('[data-ouro="color-scheme-toggle"]')!;
    },
    get trigger() {
      return host.querySelector<HTMLButtonElement>('[data-ouro-part="trigger"]')!;
    },
  };
}

const dark = () => html.classList.contains("dark");
const option = (name: string) => page.getByRole("menuitemradio", { name });

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
  localStorage.removeItem("ouro-color-scheme");
  html.classList.remove("dark");
  html.style.colorScheme = "";
  await commands.emulateMedia({ colorScheme: "light" });
});

describe("ColorSchemeToggle", () => {
  it("is an icon button named Color scheme that opens Light, Dark and System, the current one checked", async () => {
    const { trigger, toggle } = await render(
      <ColorSchemeProvider>
        <ColorSchemeToggle />
      </ColorSchemeProvider>,
    );
    expect(toggle.getAttribute("data-variant")).toBe("menu");
    expect(trigger.getAttribute("data-scheme")).toBe("light");
    expect(trigger.querySelector("svg circle")).not.toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Color scheme" }));
    await expect.element(page.getByRole("menu")).toBeVisible();
    await expect.element(option("System")).toHaveAttribute("aria-checked", "true");
    await expect.element(option("Light")).toHaveAttribute("aria-checked", "false");
    await expect.element(option("Dark")).toHaveAttribute("aria-checked", "false");
  });

  it("applies and keeps the choice, and shows the moon on a dark page", async () => {
    const { trigger } = await render(
      <ColorSchemeProvider>
        <ColorSchemeToggle />
      </ColorSchemeProvider>,
    );
    await userEvent.click(trigger);
    await expect.element(page.getByRole("menu")).toBeVisible();
    await userEvent.click(option("Dark"));
    await expect.poll(dark).toBe(true);
    expect(localStorage.getItem("ouro-color-scheme")).toBe("dark");
    await expect.poll(() => trigger.getAttribute("data-scheme")).toBe("dark");
    expect(trigger.querySelector("svg circle")).toBeNull();
    await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
    // The menu closes on the choice and gives focus back to its button.
    await expect.poll(() => document.activeElement).toBe(trigger);
    await userEvent.click(trigger);
    await expect.element(option("Dark")).toHaveAttribute("aria-checked", "true");
    await userEvent.click(option("System"));
    await expect.poll(dark).toBe(false);
    expect(localStorage.getItem("ouro-color-scheme")).toBe("system");
  });

  it("follows the system while the choice is System", async () => {
    const { trigger } = await render(
      <ColorSchemeProvider>
        <ColorSchemeToggle />
      </ColorSchemeProvider>,
    );
    await commands.emulateMedia({ colorScheme: "dark" });
    await expect.poll(dark).toBe(true);
    await expect.poll(() => trigger.getAttribute("data-scheme")).toBe("dark");
  });

  it("shows the three side by side as a segmented control", async () => {
    const { toggle } = await render(
      <ColorSchemeProvider>
        <ColorSchemeToggle variant="segmented" label="Appearance" labels={{ light: "Hell", dark: "Dunkel", system: "System" }} />
      </ColorSchemeProvider>,
    );
    expect(toggle.getAttribute("data-variant")).toBe("segmented");
    const group = page.getByRole("radiogroup", { name: "Appearance" });
    await expect.element(group).toBeVisible();
    await expect.element(page.getByRole("radio", { name: "System" })).toBeChecked();
    await userEvent.click(page.getByRole("radio", { name: "Dunkel" }));
    await expect.poll(dark).toBe(true);
    await expect.element(page.getByRole("radio", { name: "Dunkel" })).toBeChecked();
    await userEvent.click(page.getByRole("radio", { name: "Hell" }));
    await expect.poll(dark).toBe(false);
  });

  it("switches the page without a provider", async () => {
    const { trigger } = await render(<ColorSchemeToggle labels={{ dark: "Night" }} />);
    await userEvent.click(trigger);
    // The menu opens, then the choice switches the page: each is waited for, not assumed.
    await expect.element(page.getByRole("menu")).toBeVisible();
    await userEvent.click(option("Night"));
    await expect.poll(dark).toBe(true);
    await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
  });

  it("forwards a ref to the button or the group, and lets app layout classes win", async () => {
    let button: HTMLElement | null = null;
    const { trigger, toggle } = await render(<ColorSchemeToggle className="ms-4" ref={(node) => void (button = node)} />);
    expect(button).toBe(trigger);
    expect(getComputedStyle(toggle).marginInlineStart).toBe("16px");
    let group: HTMLElement | null = null;
    const segmented = await render(<ColorSchemeToggle variant="segmented" ref={(node) => void (group = node)} />);
    expect(group).toBe(segmented.host.querySelector('[role="radiogroup"]'));
  });
});

describe("ColorSchemeToggle development messages", () => {
  it.each([
    ["variant", { variant: "dropdown" }, 'variant="dropdown" is not a variant; use "menu" or "segmented"', '<ColorSchemeToggle variant="segmented" />'],
    ["value", { value: "dark" }, "value is not a prop; the toggle keeps the scheme", "const { scheme } = useColorScheme()"],
    ["onChange", { onChange: () => {} }, "onChange is not a prop; the toggle applies the choice", "const { resolved } = useColorScheme()"],
    ["theme", { theme: "dark" }, "theme is not a prop", "<ColorSchemeToggle />"],
  ])("names the fix for %s", async (_name, extra, problem, fix) => {
    const props = { ...extra } as unknown as Parameters<typeof ColorSchemeToggle>[0];
    const { toggle } = await render(<ColorSchemeToggle {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] ColorSchemeToggle: ${problem}. Fix: ${fix}.`);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(toggle.getAttribute("data-variant")).toBe("menu");
    for (const attribute of ["value", "theme"]) expect(toggle.querySelector(`[${attribute}]`)).toBeNull();
  });

  it.each([
    ["bg-red-500", 'remove "bg-red-500"; ColorSchemeToggle sets its own look from the theme'],
    ["ms-auto", ""],
  ])("checks the className %s", async (className, fix) => {
    await render(<ColorSchemeToggle className={className} />);
    if (fix) {
      expect(warn).toHaveBeenCalledWith(`[ouro-ui] ColorSchemeToggle: "${className}" sets appearance, and className is for layout only. Fix: ${fix}.`);
    } else {
      expect(warn).not.toHaveBeenCalled();
    }
  });

  it("renders the default scheme to a string without messages", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const markup = renderToString(
      <ColorSchemeProvider defaultScheme="dark">
        <ColorSchemeToggle className="bg-red-500" />
      </ColorSchemeProvider>,
    );
    expect(markup).toContain('data-ouro="color-scheme-toggle"');
    expect(markup).toContain('data-scheme="dark"');
    expect(markup).toContain('aria-label="Color scheme"');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
