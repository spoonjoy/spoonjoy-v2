import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { commands } from "vitest/browser";
import { TabBar } from "~/components/ouro/tab-bar/tab-bar";
import { act } from "~/lib/ouro/testing/act";
import { expectMotion, parseDuration } from "~/lib/ouro/testing/motion";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
const restore: Array<() => void> = [];
afterEach(async () => {
  // Last stub first, so a property stubbed twice gets its own value back.
  for (const undo of restore.splice(0).reverse()) undo();
  await act(async () => root?.unmount());
  root = undefined;
  for (const node of nodes.splice(0)) node.remove();
  await commands.emulateMedia({ reducedMotion: "no-preference" });
});

const icon = <svg viewBox="0 0 24 24" />;
const items = [
  { label: "Home", href: "/", icon },
  { label: "Recipes", href: "/recipes", icon },
];

/** A page with a TabBar and the fields a person types into. */
async function renderPage(fields = '<input data-test-harness aria-label="Title"><input data-test-harness aria-label="Notes">') {
  const page = document.createElement("div");
  page.innerHTML = fields;
  const host = document.createElement("div");
  page.append(host);
  document.body.append(page);
  nodes.push(page);
  root = createRoot(host);
  await act(async () => root!.render(<TabBar label="Main" items={items} accessory={{ label: "Search", href: "/search", icon }} />));
  return { page, nav: host.querySelector<HTMLElement>("nav")! };
}

const token = (name: string) => parseDuration(getComputedStyle(document.documentElement).getPropertyValue(name));

/** Overrides a property of `target` for the rest of the test. */
function stub(target: object, name: string, value: unknown) {
  const own = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, { configurable: true, get: () => value });
  restore.push(() => {
    if (own) Object.defineProperty(target, name, own);
    else delete (target as Record<string, unknown>)[name];
  });
}

const aside = (nav: HTMLElement) => nav.hasAttribute("data-closed");

it("fits five tabs and an accessory on a phone, each well over 44px, and a tap reaches the tab under the finger", async () => {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  const host = document.createElement("div");
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  const labels = ["Home", "Recipes", "Cookbooks", "Shopping", "Profile"];
  await act(async () =>
    root!.render(
      <TabBar
        label="Main"
        items={labels.map((label) => ({ label, href: `/${label.toLowerCase()}`, icon }))}
        accessory={{ label: "Search", href: "/search", icon }}
      />,
    ),
  );
  const links = [...host.querySelectorAll<HTMLAnchorElement>("[data-ouro-control]")];
  expect(links).toHaveLength(6);
  for (const link of links) {
    const rect = link.getBoundingClientRect();
    expect(rect.width).toBeGreaterThanOrEqual(44);
    expect(rect.height).toBeGreaterThanOrEqual(44);
    expect(rect.right).toBeLessThanOrEqual(390);
    expect(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest("a")).toBe(link);
    // No label is cut to nothing.
    expect(link.textContent!.length).toBeGreaterThan(0);
  }
});

describe("TabBar and the on-screen keyboard", () => {
  /** The keyboard comes up over the bottom of the layout viewport, or goes, as iOS and Android draw it by default. */
  function keyboard(up: boolean) {
    stub(window.visualViewport!, "height", up ? innerHeight - 300 : innerHeight);
    window.visualViewport!.dispatchEvent(new Event("resize"));
  }

  /** The keyboard resizes the page itself (Android's resizes-content): the layout viewport and the visual one shrink together. */
  function resizePage(height: number, width = innerWidth) {
    stub(window, "innerHeight", height);
    stub(window, "innerWidth", width);
    stub(window.visualViewport!, "height", height);
    window.visualViewport!.dispatchEvent(new Event("resize"));
  }

  it("slides away while the keyboard is up and comes back when it goes; with reduced motion it only fades", async () => {
    const { page, nav } = await renderPage();
    const field = page.querySelector("input")!;
    expect(nav.hasAttribute("data-open")).toBe(true);
    for (const reduced of [false, true]) {
      await commands.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      const duration = token(reduced ? "--ouro-duration-fast" : "--ouro-duration-base");
      const properties: Record<string, number> = reduced ? { opacity: duration } : { opacity: duration, translate: duration };
      field.focus();
      flushSync(() => keyboard(true));
      await expectMotion(nav, { stem: "tab-bar", state: "data-closed", properties, reduced });
      expect(getComputedStyle(nav).opacity).toBe("0");
      expect(nav.inert).toBe(true);
      if (reduced) expect(nav.getBoundingClientRect().bottom).toBeLessThanOrEqual(innerHeight);
      else expect(nav.getBoundingClientRect().top).toBeGreaterThanOrEqual(innerHeight);
      flushSync(() => keyboard(false));
      await expectMotion(nav, { stem: "tab-bar", state: "data-open", properties, reduced });
      expect(getComputedStyle(nav).opacity).toBe("1");
      expect(nav.inert).toBe(false);
      expect(nav.getBoundingClientRect().bottom).toBeLessThanOrEqual(innerHeight);
      field.blur();
    }
  });

  it("comes back when the keyboard is put away while the field keeps focus", async () => {
    // Android's back gesture, or iPad's hide-keyboard key, closes the keyboard and leaves the field focused.
    const { page, nav } = await renderPage();
    const field = page.querySelector("input")!;
    await act(async () => field.focus());
    expect(aside(nav)).toBe(false);
    await act(async () => keyboard(true));
    expect(aside(nav)).toBe(true);
    await act(async () => keyboard(false));
    expect(document.activeElement).toBe(field);
    expect(aside(nav)).toBe(false);
    expect(nav.inert).toBe(false);
  });

  it("slides away while the keyboard shrinks the visual viewport, even with no field focused, but not for a zoom", async () => {
    const { nav } = await renderPage();
    const viewport = window.visualViewport!;
    const resize = () => act(async () => viewport.dispatchEvent(new Event("resize")));
    await act(async () => keyboard(true));
    expect(aside(nav)).toBe(true);
    // A pinch zoom shows less of the page, but at scale it covers the whole screen.
    stub(viewport, "scale", 2);
    stub(viewport, "height", innerHeight / 2);
    await resize();
    expect(aside(nav)).toBe(false);
    stub(viewport, "scale", 1);
    await act(async () => keyboard(false));
    expect(aside(nav)).toBe(false);
  });

  it("slides away where the keyboard resizes the page, while a field has focus, and not for a turn of the phone", async () => {
    const { page, nav } = await renderPage();
    const field = page.querySelector("input")!;
    const [width, height] = [innerWidth, innerHeight];
    // The page shrinks, but no field has focus: something else resized it.
    await act(async () => resizePage(height - 300));
    expect(aside(nav)).toBe(false);
    await act(async () => resizePage(height));
    await act(async () => field.focus());
    expect(aside(nav)).toBe(false);
    await act(async () => resizePage(height - 300));
    expect(aside(nav)).toBe(true);
    await act(async () => resizePage(height));
    expect(document.activeElement).toBe(field);
    expect(aside(nav)).toBe(false);
    // Turned on its side, the page is wider and much shorter, with no keyboard.
    await act(async () => resizePage(width, height));
    expect(aside(nav)).toBe(false);
  });

  describe("where the browser has no visual viewport", () => {
    it("follows a focused field", async () => {
      stub(window, "visualViewport", null);
      const { page, nav } = await renderPage();
      await act(async () => page.querySelector("input")!.focus());
      expect(aside(nav)).toBe(true);
      await act(async () => page.querySelector("input")!.blur());
      expect(aside(nav)).toBe(false);
    });

    it("stays away while focus moves from field to field", async () => {
      stub(window, "visualViewport", null);
      const { page, nav } = await renderPage();
      const [title, notes] = page.querySelectorAll("input");
      await act(async () => title!.focus());
      expect(aside(nav)).toBe(true);
      const states: boolean[] = [];
      const observer = new MutationObserver(() => states.push(aside(nav)));
      observer.observe(nav, { attributes: true, attributeFilter: ["data-open", "data-closed"] });
      await act(async () => notes!.focus());
      observer.disconnect();
      expect(states).toEqual([]);
      expect(aside(nav)).toBe(true);
      await act(async () => notes!.blur());
      expect(aside(nav)).toBe(false);
    });

    it.each([
      { name: "a text area", fields: "<textarea data-test-harness aria-label='Notes'></textarea>", steps: true },
      { name: "an editable region", fields: "<div data-test-harness contenteditable='true' aria-label='Notes'></div>", steps: true },
      { name: "a search field", fields: "<input data-test-harness type='search' aria-label='Search'>", steps: true },
      { name: "a checkbox", fields: "<input data-test-harness type='checkbox' aria-label='Done'>", steps: false },
      { name: "a read-only field", fields: "<input data-test-harness readonly aria-label='Title' value='Soup'>", steps: false },
      { name: "a read-only text area", fields: "<textarea data-test-harness readonly aria-label='Notes'></textarea>", steps: false },
      { name: "a button", fields: "<button data-test-harness type='button'>Save</button>", steps: false },
      { name: "a focusable drawing", fields: "<svg data-test-harness tabindex='0' aria-label='Chart'></svg>", steps: false },
    ])("with focus in $name, steps aside: $steps", async ({ fields, steps }) => {
      stub(window, "visualViewport", null);
      const { page, nav } = await renderPage(fields);
      const field = page.querySelector<HTMLElement | SVGElement>("[data-test-harness]")!;
      await act(async () => field.focus());
      expect(document.activeElement).toBe(field);
      expect(aside(nav)).toBe(steps);
    });
  });
});
