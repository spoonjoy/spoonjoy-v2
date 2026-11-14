import type { ComponentProps, ReactNode } from "react";
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Navbar, type NavbarProps } from "~/components/ouro/navbar/navbar";
import { OuroProvider, type OuroLinkComponent } from "~/lib/ouro/ouro-provider";
import { act } from "~/lib/ouro/testing/act";
import { isTransparent } from "~/lib/ouro/testing/color";

const roots: Root[] = [];
let mounted: Element[] = [];

/** A router link that never leaves the test page. */
const StayLink: OuroLinkComponent = ({ onClick, ...props }: ComponentProps<OuroLinkComponent>) => (
  <a
    data-router=""
    {...props}
    onClick={(event) => {
      event.preventDefault();
      onClick?.(event);
    }}
  />
);

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<OuroProvider linkComponent={StayLink}>{node}</OuroProvider>));
  return {
    host,
    rerender: (next: ReactNode) => act(async () => root.render(<OuroProvider linkComponent={StayLink}>{next}</OuroProvider>)),
    get bar() {
      return host.querySelector<HTMLElement>('[data-ouro="navbar"]')!;
    },
    get menuButton() {
      return host.querySelector<HTMLElement>("[data-ouro-navbar-menu]")!;
    },
  };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await page.viewport(1024, 768);
});

describe("Navbar current-page marks", () => {
  // The pointer starts off the page: a link under it draws its hover highlight at once (`press` eases no colour), and
  // the mark under test is the underline, never a background. Vitest's unhover leaves it at the body's centre, where
  // the bar may be.
  beforeEach(async () => {
    await userEvent.hover(document.documentElement, { position: { x: -8, y: -8 }, force: true });
  });
  afterEach(async () => {
    document.documentElement.removeAttribute("dir");
    await commands.emulateMedia({ forcedColors: "none" });
  });

  function assertMark(scope: Pick<typeof page, "getByRole"> = page) {
    const current = scope.getByRole("link", { name: "Recipes", exact: true }).element();
    const other = scope.getByRole("link", { name: "Cookbooks", exact: true }).element();
    const mark = getComputedStyle(current);
    expect(mark.textDecorationLine).toBe("underline");
    expect(mark.textDecorationThickness).toBe("2px");
    expect(mark.textDecorationColor).not.toBe(mark.color);
    expect(mark.fontWeight).toBe("600");
    expect(getComputedStyle(other).textDecorationLine).toBe("none");
    expect(isTransparent(mark.backgroundColor)).toBe(true);
  }

  it("keeps its underline in the system palette", async () => {
    await render(<Navbar label="Main" items={[{ label: "Recipes", href: "/recipes" }]} currentPath="/recipes" />);
    await commands.emulateMedia({ forcedColors: "active" });
    expect(matchMedia("(forced-colors: active)").matches).toBe(true);
    const mark = getComputedStyle(page.getByRole("link", { name: "Recipes", exact: true }).element());
    expect(mark.textDecorationLine).toBe("underline");
    expect(mark.textDecorationThickness).toBe("2px");
  });

  for (const direction of ["ltr", "rtl"] as const) {
    it(`underlines the current page in its ${direction} bar, as FamilyBar marks the current site`, async () => {
      document.documentElement.dir = direction;
      await render(<Navbar label="Main" items={[{ label: "Recipes", href: "/recipes" }, { label: "Cookbooks", href: "/cookbooks" }]} currentPath="/recipes" />);
      assertMark();
    });
    it(`keeps the ${direction} underline in its phone drawer`, async () => {
      document.documentElement.dir = direction;
      await page.viewport(390, 844);
      await render(<Navbar label="Main" items={[{ label: "Recipes", href: "/recipes" }, { label: "Cookbooks", href: "/cookbooks" }]} currentPath="/recipes" />);
      await userEvent.click(page.getByRole("button", { name: "Menu", exact: true }));
      await expect.element(page.getByRole("dialog")).toBeVisible();
      assertMark(page.getByRole("dialog"));
    });
  }
});
afterEach(async () => {
  // Unmounted first, so an effect's cleanup still finds the stubs it started with: WebKit has no cancelIdleCallback of
  // its own to fall back on (ourostack/ouro-ui#685).
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const node of mounted) node.remove();
  mounted = [];
  await page.viewport(414, 896);
});

const items = [
  { label: "Recipes", href: "/recipes" },
  { label: "Cookbooks", href: "/cookbooks" },
  { label: "Shopping list", href: "/shopping-list" },
];

/** Waits until the sheet has finished opening or closing. */
/**
 * The menu button as a locator by its role. Built ahead of the press, the hidden sheet carries the button's label too, so
 * the element's own locator (by label) would find both.
 */
function press(menuButton: HTMLElement) {
  return page.getByRole("button", { name: menuButton.getAttribute("aria-label")!, exact: true });
}

async function sheetSettled() {
  await expect.poll(() => document.getAnimations().length).toBe(0);
}

describe("Navbar", () => {
  it("renders a header with a named nav of links", async () => {
    const { bar } = await render(<Navbar label="Main" items={items} />);
    expect(bar.tagName).toBe("HEADER");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect.element(nav).toBeVisible();
    expect(nav.getByRole("link").elements().map((link) => link.textContent)).toEqual(["Recipes", "Cookbooks", "Shopping list"]);
    await expect.element(nav.getByRole("link", { name: "Cookbooks" })).toHaveAttribute("href", "/cookbooks");
    await expect.element(nav.getByRole("link", { name: "Cookbooks" })).toHaveAttribute("data-router");
  });

  it("marks the current page from currentPath, and the section a page under an item is in as current but not the page", async () => {
    const { rerender } = await render(<Navbar label="Main" items={items} currentPath="/cookbooks/" />);
    await expect.element(page.getByRole("link", { name: "Cookbooks" })).toHaveAttribute("aria-current", "page");
    await expect.element(page.getByRole("link", { name: "Recipes" })).not.toHaveAttribute("aria-current");
    await rerender(<Navbar label="Main" items={items} currentPath="/recipes/12?step=2" />);
    // A screen reader hears one current page: the page itself, which a deeper page's own navigation marks.
    await expect.element(page.getByRole("link", { name: "Recipes" })).toHaveAttribute("aria-current", "true");
    expect(getComputedStyle(page.getByRole("link", { name: "Recipes" }).element()).textDecorationLine).toBe("underline");
    await expect.element(page.getByRole("link", { name: "Cookbooks" })).not.toHaveAttribute("aria-current");
  });

  it("lets an item's own current win over currentPath", async () => {
    await render(<Navbar label="Main" items={[items[0]!, { ...items[1]!, current: true }]} currentPath="/recipes" />);
    await expect.element(page.getByRole("link", { name: "Cookbooks" })).toHaveAttribute("aria-current", "page");
    await expect.element(page.getByRole("link", { name: "Recipes" })).not.toHaveAttribute("aria-current");
  });

  it("shows the brand at the start and the actions at the end", async () => {
    const { bar } = await render(
      <Navbar label="Main" items={items} brand={<span data-testid="brand">Spoonjoy</span>} actions={<button type="button">Account</button>} />,
    );
    const brand = page.getByTestId("brand").element().getBoundingClientRect();
    const first = page.getByRole("link", { name: "Recipes" }).element().getBoundingClientRect();
    const account = page.getByRole("button", { name: "Account" }).element().getBoundingClientRect();
    expect(brand.right).toBeLessThanOrEqual(first.left);
    expect(account.right).toBeGreaterThan(bar.getBoundingClientRect().right - 40);
  });

  it("hides the menu button from 640px up", async () => {
    const { menuButton } = await render(<Navbar label="Main" items={items} />);
    expect(getComputedStyle(menuButton).display).toBe("none");
    expect(menuButton.hasAttribute("aria-haspopup")).toBe(false);
  });

  it("puts the links in the server HTML, with the current page marked", () => {
    const html = renderToString(<Navbar label="Main" items={items} currentPath="/recipes" />);
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>Recipes<\/a>/);
    expect(html).toContain('href="/shopping-list"');
  });

  it("collapses the links into a sheet behind a menu button below 640px", async () => {
    await page.viewport(390, 844);
    const { menuButton, bar } = await render(<Navbar label="Main" items={items} currentPath="/recipes" brand="Spoonjoy" />);
    expect(page.getByRole("navigation", { name: "Main" }).query()).toBeNull();
    expect(getComputedStyle(menuButton).display).not.toBe("none");
    expect(menuButton.getAttribute("aria-label")).toBe("Menu");
    expect(menuButton.getAttribute("aria-haspopup")).toBe("dialog");
    expect(menuButton.getAttribute("aria-expanded")).toBe("false");
    expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth);
    await userEvent.click(press(menuButton));
    const sheet = page.getByRole("dialog", { name: "Menu" });
    await expect.element(sheet).toBeVisible();
    expect(menuButton.getAttribute("aria-expanded")).toBe("true");
    const nav = sheet.getByRole("navigation", { name: "Main" });
    expect(nav.getByRole("link").elements().map((link) => link.textContent)).toEqual(["Recipes", "Cookbooks", "Shopping list"]);
    await expect.element(nav.getByRole("link", { name: "Recipes" })).toHaveAttribute("aria-current", "page");
    await expect.poll(() => Math.round(sheet.element().getBoundingClientRect().left)).toBe(0);
  });

  it("marks the section a page is in as current but not the page in the sheet too, and no other link", async () => {
    await page.viewport(390, 844);
    const { menuButton } = await render(<Navbar label="Main" items={items} currentPath="/recipes/12" />);
    await userEvent.click(press(menuButton));
    const nav = page.getByRole("dialog", { name: "Menu" }).getByRole("navigation", { name: "Main" });
    await expect.element(nav.getByRole("link", { name: "Recipes" })).toHaveAttribute("aria-current", "true");
    await expect.element(nav.getByRole("link", { name: "Cookbooks" })).not.toHaveAttribute("aria-current");
    await expect.element(nav.getByRole("link", { name: "Shopping list" })).not.toHaveAttribute("aria-current");
  });

  it("lets an item's own current win over currentPath in the sheet too", async () => {
    await page.viewport(390, 844);
    const { menuButton } = await render(<Navbar label="Main" items={[items[0]!, { ...items[1]!, current: true }]} currentPath="/recipes" />);
    await userEvent.click(press(menuButton));
    const nav = page.getByRole("dialog", { name: "Menu" }).getByRole("navigation", { name: "Main" });
    await expect.element(nav.getByRole("link", { name: "Cookbooks" })).toHaveAttribute("aria-current", "page");
    await expect.element(nav.getByRole("link", { name: "Recipes" })).not.toHaveAttribute("aria-current");
  });

  it("builds the sheet while the page is idle once the menu button shows, and keeps it, hidden, between opens", async () => {
    await page.viewport(390, 844);
    const { menuButton } = await render(<Navbar label="Main" items={items} />);
    const popup = () => document.querySelector<HTMLElement>('[data-ouro="sheet"]');
    // Built ahead of the press, hidden: nothing in it is seen, heard or reached.
    await expect.poll(popup).not.toBeNull();
    expect(popup()!.hidden).toBe(true);
    expect(page.getByRole("dialog").elements()).toHaveLength(0);
    const built = popup();
    await userEvent.click(press(menuButton));
    await expect.element(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
    // The press showed the sheet it had: the same element.
    expect(popup()).toBe(built);
    await sheetSettled();
    await userEvent.keyboard("{Escape}");
    // Kept, hidden, for the next press: built afresh once the close has finished.
    await expect.poll(() => popup() !== built && popup()?.hidden).toBe(true);
  });

  it("builds the sheet when the menu button comes to show, on a window narrowed to a phone's", async () => {
    await page.viewport(1024, 768);
    await render(<Navbar label="Main" items={items} />);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(document.querySelector('[data-ouro="sheet"]')).toBeNull();
    await page.viewport(390, 844);
    await expect.poll(() => document.querySelector<HTMLElement>('[data-ouro="sheet"]')?.hidden).toBe(true);
  });

  it("builds the sheet as soon as the browser says the page is idle, before the half second a browser without an idle callback waits", async () => {
    // An idle callback that comes at once.
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => setTimeout(callback, 0));
    vi.stubGlobal("cancelIdleCallback", (id: number) => clearTimeout(id));
    await page.viewport(390, 844);
    await render(<Navbar label="Main" items={items} />);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(document.querySelector<HTMLElement>('[data-ouro="sheet"]')?.hidden).toBe(true);
  });

  it("builds the sheet half a second in where the browser has no idle callback (Safari)", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    await page.viewport(390, 844);
    await render(<Navbar label="Main" items={items} />);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(document.querySelector('[data-ouro="sheet"]')).toBeNull();
    await expect.poll(() => document.querySelector<HTMLElement>('[data-ouro="sheet"]')?.hidden).toBe(true);
  });

  for (const idle of [true, false]) {
    it(`builds the sheet's frame first and puts its content in on a later turn${idle ? "" : ", where the browser has no idle callback"}`, async () => {
      // An idle callback that comes 300 ms on.
      vi.stubGlobal("requestIdleCallback", idle ? (callback: () => void) => setTimeout(callback, 300) : undefined);
      vi.stubGlobal("cancelIdleCallback", idle ? (id: number) => clearTimeout(id) : undefined);
      await page.viewport(390, 844);
      await render(<Navbar label="Main" items={items} />);
      const popup = () => document.querySelector<HTMLElement>('[data-ouro="sheet"]');
      const links = () => popup()?.querySelectorAll("a[href]").length ?? 0;
      await expect.poll(popup).not.toBeNull();
      // Its frame alone, with no links yet; then, a turn later, the links.
      expect(popup()!.hidden).toBe(true);
      expect(links()).toBe(0);
      await expect.poll(links).toBeGreaterThan(0);
      expect(popup()!.hidden).toBe(true);
    });

    if (idle)
    it("opens with its links on a press between the sheet's frame and its content", async () => {
      // The frame's idle turn comes at once; the content's is held until after the press.
      const held: Array<() => void> = [];
      let fired = false;
      vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
        if (fired) return held.push(callback);
        return setTimeout(() => {
          fired = true;
          callback();
        }, 0);
      });
      vi.stubGlobal("cancelIdleCallback", (id: number) => clearTimeout(id));
      await page.viewport(390, 844);
      const { menuButton } = await render(<Navbar label="Main" items={items} />);
      await expect.poll(() => document.querySelector('[data-ouro="sheet"]')).not.toBeNull();
      expect(document.querySelectorAll('[data-ouro="sheet"] a[href]')).toHaveLength(0);
      await userEvent.click(press(menuButton));
      await expect.element(page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: items[0]!.label })).toBeVisible();
      // The content's turn, at last, leaves the open sheet as it is.
      for (const callback of held.splice(0)) callback();
      await expect.element(page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: items[0]!.label })).toBeVisible();
      // The sheet built afresh after the close takes its frame first and its content on the next turn too.
      await sheetSettled();
      await userEvent.keyboard("{Escape}");
      await expect.poll(() => document.querySelector<HTMLElement>('[data-ouro="sheet"]')?.hidden).toBe(true);
      await expect.poll(() => held.length).toBeGreaterThan(0);
      expect(document.querySelectorAll('[data-ouro="sheet"] a[href]')).toHaveLength(0);
      for (const callback of held.splice(0)) callback();
      await expect.poll(() => document.querySelectorAll('[data-ouro="sheet"] a[href]').length).toBe(items.length);
    });

    it(`builds no sheet when the menu button hides again before the page is idle${idle ? "" : ", where the browser has no idle callback"}`, async () => {
      // An idle callback that comes 300 ms on, cancelled as a timer is.
      vi.stubGlobal("requestIdleCallback", idle ? (callback: () => void) => setTimeout(callback, 300) : undefined);
      vi.stubGlobal("cancelIdleCallback", idle ? (id: number) => clearTimeout(id) : undefined);
      await page.viewport(390, 844);
      await render(<Navbar label="Main" items={items} />);
      await page.viewport(1024, 768);
      await new Promise((resolve) => setTimeout(resolve, 800));
      expect(document.querySelector('[data-ouro="sheet"]')).toBeNull();
    });
  }

  it("opens afresh after each close: the menu prop's state and the sheet's scroll as the first open had them", async () => {
    function Filter() {
      const [text, setText] = useState("");
      return (
        <>
          <input aria-label="Filter" value={text} onChange={(event) => setText(event.currentTarget.value)} />
          <div style={{ height: 3000 }} />
        </>
      );
    }
    await page.viewport(390, 844);
    await render(<Navbar label="Main" items={items} menu={<Filter />} />);
    // The sheet built and kept before the first press, as on a page that has been idle.
    await expect.poll(() => document.querySelector<HTMLElement>('[data-ouro="sheet"]')?.hidden).toBe(true);
    const button = page.getByRole("button", { name: "Menu", exact: true });
    await userEvent.click(button);
    await userEvent.fill(page.getByRole("textbox", { name: "Filter" }), "rec");
    const body = () => document.querySelector<HTMLElement>("[data-ouro-sheet-content]")!;
    await expect.poll(() => body().scrollHeight > body().clientHeight).toBe(true);
    body().scrollTop = 400;
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector<HTMLElement>('[data-ouro="sheet"]')?.hidden).toBe(true);
    // After every close, not only the first.
    for (let round = 0; round < 2; round += 1) {
      await userEvent.click(button);
      await expect.element(page.getByRole("textbox", { name: "Filter" })).toHaveValue("");
      expect(body().scrollTop).toBe(0);
      await userEvent.fill(page.getByRole("textbox", { name: "Filter" }), "rec");
      body().scrollTop = 400;
      await userEvent.keyboard("{Escape}");
      await expect.poll(() => document.querySelector<HTMLElement>('[data-ouro="sheet"]')?.hidden).toBe(true);
    }
  });

  it("builds no sheet where the links fit the bar", async () => {
    await page.viewport(1024, 768);
    await render(<Navbar label="Main" items={items} />);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(document.querySelector('[data-ouro="sheet"]')).toBeNull();
  });

  it("closes the sheet when a link is chosen", async () => {
    await page.viewport(390, 844);
    const { menuButton } = await render(<Navbar label="Main" items={items} />);
    await userEvent.click(press(menuButton));
    await sheetSettled();
    await userEvent.click(page.getByRole("dialog").getByRole("link", { name: "Cookbooks" }));
    await expect.poll(() => page.getByRole("dialog").elements().length).toBe(0);
  });

  it("leaves the sheet open for a link opened elsewhere, with a modifier key held", async () => {
    await page.viewport(390, 844);
    const { menuButton } = await render(
      <Navbar
        label="Main"
        items={items}
        menu={
          <div>
            <a href="#elsewhere">Elsewhere</a>
          </div>
        }
      />,
    );
    await userEvent.click(press(menuButton));
    await sheetSettled();
    const nav = page.getByRole("dialog").getByRole("navigation", { name: "Main" });
    // The browser's own default (a new tab) is held back after the menu has seen the click, so the test page stays.
    const hold = (event: Event) => event.preventDefault();
    window.addEventListener("click", hold);
    try {
      for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
        nav.getByRole("link", { name: "Elsewhere" }).element().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, [modifier]: true }));
        await act(async () => {});
        expect(menuButton.getAttribute("aria-expanded"), modifier).toBe("true");
      }
    } finally {
      window.removeEventListener("click", hold);
    }
  });

  it("shows the menu prop in the sheet in place of the links, and closes it when a link there is chosen", async () => {
    await page.viewport(390, 844);
    const { menuButton } = await render(
      <Navbar
        label="Main"
        items={items}
        menu={
          <div>
            <p>Recipes</p>
            <a href="#new-recipe">New recipe</a>
          </div>
        }
      />,
    );
    await userEvent.click(press(menuButton));
    await sheetSettled();
    const nav = page.getByRole("dialog").getByRole("navigation", { name: "Main" });
    expect(nav.getByRole("link").elements().map((link) => link.textContent)).toEqual(["New recipe"]);
    await userEvent.click(nav.getByText("Recipes"));
    await act(async () => {});
    expect(menuButton.getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(nav.getByRole("link", { name: "New recipe" }));
    await expect.poll(() => page.getByRole("dialog").elements().length).toBe(0);
    await expect.poll(() => document.activeElement).toBe(menuButton);
  });

  it("returns focus to the menu button when the sheet closes with Escape", async () => {
    await page.viewport(390, 844);
    const { menuButton } = await render(<Navbar label="Main" items={items} />);
    await userEvent.click(press(menuButton));
    await sheetSettled();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => page.getByRole("dialog").elements().length).toBe(0);
    await expect.poll(() => document.activeElement).toBe(menuButton);
  });

  it("closes the sheet when the screen grows past 640px", async () => {
    await page.viewport(390, 844);
    const { menuButton } = await render(<Navbar label="Main" items={items} />);
    await userEvent.click(press(menuButton));
    await expect.element(page.getByRole("dialog")).toBeVisible();
    await page.viewport(1024, 768);
    await expect.poll(() => page.getByRole("dialog").elements().length).toBe(0);
    await page.viewport(390, 844);
    await act(async () => {});
    expect(page.getByRole("dialog").query()).toBeNull();
  });

  it("takes the menu's strings as props", async () => {
    await page.viewport(390, 844);
    const { menuButton } = await render(<Navbar label="Main" items={items} menuLabel="Menü" closeLabel="Schließen" />);
    expect(menuButton.getAttribute("aria-label")).toBe("Menü");
    await userEvent.click(press(menuButton));
    await expect.element(page.getByRole("dialog", { name: "Menü" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Schließen" })).toBeInTheDocument();
  });

  it("passes className and ref to the header", async () => {
    let node: HTMLElement | null = null;
    const { bar } = await render(
      <Navbar
        label="Main"
        items={items}
        className="mb-4"
        ref={(element) => {
          node = element;
        }}
      />,
    );
    expect(bar.classList.contains("mb-4")).toBe(true);
    expect(node).toBe(bar);
  });

  it("does not transition the links' position with reduced motion", async () => {
    await render(<Navbar label="Main" items={items} />);
    const link = page.getByRole("link", { name: "Recipes" }).element();
    expect(getComputedStyle(link).transitionProperty).not.toMatch(/all|transform|translate|top|left/);
  });

  it("warns about appearance classes and the props agents guess", async () => {
    const guessed = { label: "Main", items, className: "bg-white", links: items, logo: "x", pathname: "/", children: "x" } as unknown as NavbarProps;
    await render(<Navbar {...guessed} />);
    const messages = warn.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(messages).toContain('[ouro-ui] Navbar: "bg-white" sets appearance, and className is for layout only. Fix: remove "bg-white"; Navbar sets its own look.');
    expect(messages).toContain('[ouro-ui] Navbar: links is not a prop. Fix: <Navbar label="Main" items={[{ label: "Recipes", href: "/recipes" }]} />.');
    expect(messages).toContain("[ouro-ui] Navbar: logo is not a prop. Fix: <Navbar brand={<Logo />}>.");
    expect(messages).toContain("[ouro-ui] Navbar: pathname is not a prop. Fix: <Navbar currentPath={pathname}>.");
    expect(messages).toContain('[ouro-ui] Navbar: children are not rendered. Fix: <Navbar label="Main" items={[{ label: "Recipes", href: "/recipes" }]} brand={…} actions={…} />.');
  });

  it("warns when the label is missing", async () => {
    const unnamed = { items } as unknown as NavbarProps;
    await render(<Navbar {...unnamed} />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] Navbar: label is required; it names the navigation for screen readers. Fix: <Navbar label="Main">.');
  });
});

describe("Navbar at tablet widths and with groups", () => {
  // Long enough not to fit at 768px in any app's font (these tests run with the app's theme), and
  // short enough to fit at 1600px.
  const eight = ["Kitchen and pantry", "My saved recipes", "Shared cookbooks", "Weekly shopping list", "Spoons and forks", "Fellow chefs", "Discover new dishes", "Kitchen Search"].map((label) => ({
    label,
    href: `/${label.toLowerCase().replaceAll(" ", "-")}`,
  }));

  it("collapses into the menu button whenever its links do not fit, from 640px up too", async () => {
    await page.viewport(768, 800);
    const { menuButton, bar } = await render(<Navbar label="Main" items={eight} />);
    await expect.poll(() => getComputedStyle(menuButton).display).not.toBe("none");
    expect(menuButton.getAttribute("aria-haspopup")).toBe("dialog");
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(768);
    expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth);
    // The bar's links are out of the way and out of the tab order.
    expect(page.getByRole("navigation", { name: "Main" }).query()).toBeNull();
    await userEvent.click(press(menuButton));
    const sheet = page.getByRole("dialog", { name: "Menu" });
    await expect.element(sheet.getByRole("link", { name: "Kitchen Search" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => page.getByRole("dialog").elements().length).toBe(0);
    // With room, the links come back and the button goes.
    await page.viewport(1600, 800);
    await expect.poll(() => getComputedStyle(menuButton).display).toBe("none");
    await expect.element(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Kitchen Search" })).toBeVisible();
  });

  it("closes the sheet when the links come to fit", async () => {
    await page.viewport(768, 800);
    const { menuButton } = await render(<Navbar label="Main" items={eight} />);
    await expect.poll(() => getComputedStyle(menuButton).display).not.toBe("none");
    await userEvent.click(press(menuButton));
    await expect.element(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
    await page.viewport(1600, 800);
    await expect.poll(() => page.getByRole("dialog").elements().length).toBe(0);
  });

  const grouped = [
    { label: "Recipes", links: [
      { label: "Browse", href: "/recipes", description: "Everything you have saved." },
      { label: "Drafts", href: "/recipes/drafts" },
    ] },
    { label: "Cookbooks", href: "/cookbooks" },
  ];

  it("opens a group of links as a panel in the bar", async () => {
    await render(<Navbar label="Main" items={grouped} currentPath="/recipes/drafts" />);
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect.element(nav.getByRole("link", { name: "Cookbooks" })).toBeVisible();
    await userEvent.click(nav.getByRole("button", { name: "Recipes" }));
    await expect.element(page.getByRole("link", { name: /Drafts/ })).toHaveAttribute("aria-current", "page");
    await expect.element(page.getByText("Everything you have saved.")).toBeVisible();
  });

  it("lists a group of links under its name in the sheet", async () => {
    await page.viewport(390, 844);
    const { menuButton } = await render(<Navbar label="Main" items={grouped} currentPath="/recipes/drafts" />);
    await userEvent.click(press(menuButton));
    const sheet = page.getByRole("dialog", { name: "Menu" });
    const group = sheet.getByRole("list", { name: "Recipes" });
    await expect.element(group).toBeVisible();
    expect(group.getByRole("link").elements().map((link) => link.textContent)).toEqual(["Browse", "Drafts"]);
    await expect.element(group.getByRole("link", { name: "Drafts" })).toHaveAttribute("aria-current", "page");
    await expect.element(sheet.getByRole("link", { name: "Cookbooks" })).toBeVisible();
  });

  it("puts a group's button and the bar's links in the server HTML", () => {
    const html = renderToString(<Navbar label="Main" items={grouped} currentPath="/cookbooks" />);
    expect(html).toMatch(/<button[^>]*>Recipes/);
    expect(html).toMatch(/aria-current="page"[^>]*>Cookbooks</);
  });
});
