import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page } from "vitest/browser";
import { TabBar, type TabBarItem } from "~/components/ouro/tab-bar/tab-bar";
import { OuroProvider, type OuroLinkComponent } from "~/lib/ouro/ouro-provider";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    get root() {
      return host.querySelector<HTMLElement>('[data-ouro="tab-bar"]')!;
    },
    get nav() {
      return host.querySelector<HTMLElement>("nav")!;
    },
    get tabs() {
      return [...host.querySelectorAll<HTMLAnchorElement>('[data-ouro-part="tab"]')];
    },
    get accessory() {
      return host.querySelector<HTMLAnchorElement>('[data-ouro-part="accessory"]');
    },
  };
}

const icon = (path: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d={path} />
  </svg>
);

const items: TabBarItem[] = [
  { label: "Home", href: "/", icon: icon("M3 10 12 3l9 7v11H3z"), paths: ["/account"] },
  { label: "Recipes", href: "/recipes", icon: icon("M4 4h16v16H4z"), paths: ["/saved-recipes"] },
  { label: "Shopping", href: "/shopping-list", icon: icon("M5 7h14l-1 13H6z") },
];
const search: TabBarItem = { label: "Search", href: "/search", icon: icon("M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14m9 16-4-4") };

const currentLabels = (tabs: HTMLAnchorElement[]) => tabs.filter((tab) => tab.getAttribute("aria-current") === "page").map((tab) => tab.textContent);

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await page.viewport(390, 844);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
  await commands.emulateMedia({ reducedMotion: "no-preference" });
});

describe("TabBar", () => {
  it("is a labelled navigation of links, each named by its label, with the icons hidden", async () => {
    const { nav, tabs, accessory } = await render(<TabBar label="Main" items={items} accessory={search} currentPath="/recipes" />);
    expect(nav.getAttribute("aria-label")).toBe("Main");
    await expect.element(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    for (const name of ["Home", "Recipes", "Shopping", "Search"]) {
      await expect.element(page.getByRole("link", { name, exact: true })).toBeVisible();
    }
    expect(tabs.map((tab) => tab.getAttribute("href"))).toEqual(["/", "/recipes", "/shopping-list"]);
    expect(accessory!.getAttribute("href")).toBe("/search");
    for (const link of [...tabs, accessory!]) expect(link.querySelector("svg")!.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it.each([
    ["/", "Home"],
    ["/account/settings", "Home"],
    ["/recipes/12", "Recipes"],
    ["/saved-recipes", "Recipes"],
    ["/shopping-list", "Shopping"],
    ["/search", "Search"],
    ["/chefs", null],
  ])("marks the tab that owns %s", async (path, expected) => {
    const { tabs, accessory } = await render(<TabBar label="Main" items={items} accessory={search} currentPath={path} />);
    const current = [...tabs, accessory!].filter((tab) => tab.getAttribute("aria-current") === "page");
    expect(current.map((tab) => tab.textContent)).toEqual(expected ? [expected] : []);
  });

  it("lets an item's current flag win over the path", async () => {
    const flagged = items.map((item) => (item.label === "Shopping" ? { ...item, current: true } : item));
    const { tabs } = await render(<TabBar label="Main" items={flagged} currentPath="/recipes" />);
    expect(currentLabels(tabs)).toEqual(["Shopping"]);
  });

  it("gives the current tab the accent wash and the rest the muted text", async () => {
    const { tabs } = await render(<TabBar label="Main" items={items} currentPath="/recipes" />);
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--accent)";
    probe.style.color = "var(--muted-foreground)";
    document.body.append(probe);
    mounted.push(probe);
    await expect.poll(() => getComputedStyle(tabs[1]!).backgroundColor).toBe(getComputedStyle(probe).backgroundColor);
    expect(getComputedStyle(tabs[0]!).color).toBe(getComputedStyle(probe).color);
  });

  it("sits fixed at the bottom of a phone screen, with equal 64px tabs, and keeps its room in the page", async () => {
    const { root, nav, tabs, accessory } = await render(
      <div>
        <p style={{ margin: 0, height: 900 }}>Content</p>
        <TabBar label="Main" items={items} accessory={search} />
      </div>,
    );
    expect(getComputedStyle(nav).position).toBe("fixed");
    const bar = nav.getBoundingClientRect();
    expect(bar.bottom).toBe(innerHeight - 16);
    expect(nav.querySelector("ul")!.getBoundingClientRect().left).toBe(12);
    expect(accessory!.getBoundingClientRect().right).toBe(innerWidth - 12);
    const widths = tabs.map((tab) => Math.round(tab.getBoundingClientRect().width));
    expect(new Set(widths).size).toBe(1);
    for (const tab of tabs) expect(tab.getBoundingClientRect().height).toBe(56);
    expect(accessory!.getBoundingClientRect().height).toBe(64);
    // The room it keeps: the 64px bar and 16px above and below it.
    expect(root.getBoundingClientRect().height).toBe(96);
  });

  it.each([
    ["sm", 640],
    ["md", 768],
    ["lg", 1024],
    ["xl", 1280],
  ] as const)("hides from %s (%ipx), and with never stays", async (hideFrom, width) => {
    await page.viewport(width - 1, 800);
    const { root } = await render(<TabBar label="Main" items={items} hideFrom={hideFrom} />);
    expect(getComputedStyle(root).display).toBe("block");
    await page.viewport(width, 800);
    await expect.poll(() => getComputedStyle(root).display).toBe("none");
    await act(async () => roots.at(-1)!.render(<TabBar label="Main" items={items} hideFrom="never" />));
    expect(getComputedStyle(root).display).toBe("block");
  });

  it("goes through the provider's link component", async () => {
    const RouterLink: OuroLinkComponent = (props) => <a data-router="" {...props} />;
    const { tabs, accessory } = await render(
      <OuroProvider linkComponent={RouterLink}>
        <TabBar label="Main" items={items} accessory={search} />
      </OuroProvider>,
    );
    for (const link of [...tabs, accessory!]) expect(link.hasAttribute("data-router")).toBe(true);
  });

  it("forwards a ref to the nav", async () => {
    let element: HTMLElement | null = null;
    const { nav } = await render(<TabBar label="Main" items={items} ref={(node) => void (element = node)} />);
    expect(element).toBe(nav);
  });

  /** The tab's settled scale while the real mouse holds it down. */
  async function pressScale(selector: string, element: HTMLElement) {
    await commands.pointerPress({ selector, action: "down" });
    try {
      let last = "";
      await expect
        .poll(() => {
          const scale = getComputedStyle(element).scale;
          const still = scale === last && element.getAnimations().length === 0;
          last = scale;
          return still;
        }, { interval: 50 })
        .toBe(true);
      return last;
    } finally {
      await commands.pointerPress({ selector, action: "up" });
    }
  }

  it("stays in place when a field takes focus under a fine pointer, which brings up no on-screen keyboard", async () => {
    const { host, nav } = await render(<TabBar label="Main" items={items} />);
    const field = document.createElement("input");
    field.setAttribute("aria-label", "Title");
    field.setAttribute("data-test-harness", "");
    host.before(field);
    mounted.push(field);
    expect(matchMedia("(pointer: fine)").matches).toBe(true);
    await act(async () => field.focus());
    expect(document.activeElement).toBe(field);
    expect(nav.hasAttribute("data-open")).toBe(true);
    expect(nav.hasAttribute("data-closed")).toBe(false);
    expect(nav.inert).toBe(false);
    expect(getComputedStyle(nav).opacity).toBe("1");
  });

  it("scales a tab while pressed, and not with reduced motion", async () => {
    const { tabs, accessory } = await render(<TabBar label="Main" items={items} accessory={search} />);
    for (const link of [tabs[0]!, accessory!]) link.addEventListener("click", (event) => event.preventDefault());
    tabs[0]!.setAttribute("data-press-probe", "");
    expect(await pressScale("[data-press-probe]", tabs[0]!)).toBe("0.97");
    expect(await pressScale('[data-ouro-part="accessory"]', accessory!)).toBe("0.97");
    await commands.emulateMedia({ reducedMotion: "reduce" });
    expect(await pressScale("[data-press-probe]", tabs[0]!)).toBe("none");
  });
});

describe("TabBar development messages", () => {
  const example = '<TabBar label="Main" items={[{ label: "Recipes", href: "/recipes", icon: <BookOpen /> }]} />';
  it.each([
    ["label", { label: "" }, "label is required; it names the navigation for screen readers", '<TabBar label="Main">'],
    ["tabs", { tabs: items }, "tabs is not a prop", example],
    ["links", { links: items }, "links is not a prop", example],
    ["pathname", { pathname: "/" }, "pathname is not a prop", "<TabBar currentPath={pathname}>"],
    ["value", { value: "home" }, "value is not a prop; the current tab follows the page's path", "<TabBar currentPath={pathname}>"],
    ["children", { children: "Home" }, "children are not rendered", example],
    ["hideFrom", { hideFrom: "desktop" }, 'hideFrom="desktop" is not a breakpoint; use "sm", "md", "lg", "xl" or "never"', '<TabBar hideFrom="lg">'],
    ["items", { items: [...items, ...items] }, "6 tabs do not fit a phone's width", "keep two to five items, and link the rest from a page of their own"],
  ])("names the fix for %s", async (_name, extra, problem, fix) => {
    const props = { label: "Main", items, ...extra } as unknown as Parameters<typeof TabBar>[0];
    const { root, nav } = await render(<TabBar {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] TabBar: ${problem}. Fix: ${fix}.`);
    expect(warn).toHaveBeenCalledTimes(1);
    for (const attribute of ["tabs", "links", "pathname", "value"]) expect(nav.hasAttribute(attribute)).toBe(false);
    expect(root.textContent).not.toContain("Home" + "Home" + "Home");
  });

  it("renders the default breakpoint for an unknown one", async () => {
    const props = { label: "Main", items, hideFrom: "desktop" } as unknown as Parameters<typeof TabBar>[0];
    const { root } = await render(<TabBar {...props} />);
    expect(root.className).toContain("sm:hidden");
  });

  it.each([
    ["bg-red-500", 'remove "bg-red-500"; TabBar sets its own look from the theme'],
    ["mt-4", ""],
  ])("checks the className %s", async (className, fix) => {
    await render(<TabBar label="Main" items={items} className={className} />);
    if (fix) {
      expect(warn).toHaveBeenCalledWith(`[ouro-ui] TabBar: "${className}" sets appearance, and className is for layout only. Fix: ${fix}.`);
    } else {
      expect(warn).not.toHaveBeenCalled();
    }
  });

  it("renders the current tab to a string without messages", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(<TabBar label="Main" items={items} accessory={search} currentPath="/recipes/12" className="bg-red-500" />);
    expect(html).toContain('data-ouro="tab-bar"');
    expect(html).toMatch(/aria-current="page"[^>]*>.*Recipes/);
    // In place: only the browser knows whether the keyboard is up.
    expect(html).toMatch(/<nav[^>]*data-open=""/);
    expect(html).not.toContain("data-closed=");
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
