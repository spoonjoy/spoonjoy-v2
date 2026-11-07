import type { ComponentProps, ReactNode } from "react";
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
  afterEach(async () => {
    document.documentElement.removeAttribute("dir");
    await commands.emulateMedia({ forcedColors: "none" });
  });

  function assertMark(direction: "ltr" | "rtl", scope: Pick<typeof page, "getByRole"> = page) {
    const current = scope.getByRole("link", { name: "Recipes", exact: true }).element();
    const other = scope.getByRole("link", { name: "Cookbooks", exact: true }).element();
    const marker = getComputedStyle(current, "::before");
    expect(marker.content).toBe('""');
    expect(parseFloat(marker.width)).toBe(2);
    expect(parseFloat(marker.height)).toBeGreaterThan(0);
    expect(marker.opacity).toBe("1");
    expect(marker.visibility).toBe("visible");
    expect(marker[direction === "rtl" ? "right" : "left"]).toBe("0px");
    expect(getComputedStyle(other, "::before").content).toBe("none");
    expect(isTransparent(getComputedStyle(current).backgroundColor)).toBe(true);
  }

  for (const direction of ["ltr", "rtl"] as const) {
    it(`keeps its ${direction} start-edge mark visible in the system palette`, async () => {
      document.documentElement.dir = direction;
      await render(<Navbar label="Main" items={[{ label: "Recipes", href: "/recipes" }]} currentPath="/recipes" />);
      await commands.emulateMedia({ forcedColors: "active" });
      expect(matchMedia("(forced-colors: active)").matches).toBe(true);
      const current = page.getByRole("link", { name: "Recipes", exact: true }).element();
      const marker = getComputedStyle(current, "::before");
      expect(marker[direction === "rtl" ? "borderRightWidth" : "borderLeftWidth"]).toBe("2px");
      expect(marker.borderInlineStartColor).toBe(getComputedStyle(current).color);
      expect(marker.borderInlineStartColor).not.toBe(getComputedStyle(current).backgroundColor);
    });
    it(`shows the ${direction} start-edge mark in its bar`, async () => {
      document.documentElement.dir = direction;
      await render(<Navbar label="Main" items={[{ label: "Recipes", href: "/recipes" }, { label: "Cookbooks", href: "/cookbooks" }]} currentPath="/recipes" />);
      assertMark(direction);
    });
    it(`keeps the ${direction} mark in its phone drawer`, async () => {
      document.documentElement.dir = direction;
      await page.viewport(390, 844);
      await render(<Navbar label="Main" items={[{ label: "Recipes", href: "/recipes" }, { label: "Cookbooks", href: "/cookbooks" }]} currentPath="/recipes" />);
      await userEvent.click(page.getByRole("button", { name: "Menu", exact: true }));
      await expect.element(page.getByRole("dialog")).toBeVisible();
      assertMark(direction, page.getByRole("dialog"));
    });
  }
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
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

  it("marks the current page from currentPath, also for a page under an item", async () => {
    const { rerender } = await render(<Navbar label="Main" items={items} currentPath="/cookbooks" />);
    await expect.element(page.getByRole("link", { name: "Cookbooks" })).toHaveAttribute("aria-current", "page");
    await expect.element(page.getByRole("link", { name: "Recipes" })).not.toHaveAttribute("aria-current");
    await rerender(<Navbar label="Main" items={items} currentPath="/recipes/12?step=2" />);
    await expect.element(page.getByRole("link", { name: "Recipes" })).toHaveAttribute("aria-current", "page");
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
    await userEvent.click(menuButton);
    const sheet = page.getByRole("dialog", { name: "Menu" });
    await expect.element(sheet).toBeVisible();
    expect(menuButton.getAttribute("aria-expanded")).toBe("true");
    const nav = sheet.getByRole("navigation", { name: "Main" });
    expect(nav.getByRole("link").elements().map((link) => link.textContent)).toEqual(["Recipes", "Cookbooks", "Shopping list"]);
    await expect.element(nav.getByRole("link", { name: "Recipes" })).toHaveAttribute("aria-current", "page");
    await expect.poll(() => Math.round(sheet.element().getBoundingClientRect().left)).toBe(0);
  });

  it("closes the sheet when a link is chosen", async () => {
    await page.viewport(390, 844);
    const { menuButton } = await render(<Navbar label="Main" items={items} />);
    await userEvent.click(menuButton);
    await sheetSettled();
    await userEvent.click(page.getByRole("dialog").getByRole("link", { name: "Cookbooks" }));
    await expect.poll(() => page.getByRole("dialog").elements().length).toBe(0);
  });

  it("returns focus to the menu button when the sheet closes with Escape", async () => {
    await page.viewport(390, 844);
    const { menuButton } = await render(<Navbar label="Main" items={items} />);
    await userEvent.click(menuButton);
    await sheetSettled();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => page.getByRole("dialog").elements().length).toBe(0);
    await expect.poll(() => document.activeElement).toBe(menuButton);
  });

  it("closes the sheet when the screen grows past 640px", async () => {
    await page.viewport(390, 844);
    const { menuButton } = await render(<Navbar label="Main" items={items} />);
    await userEvent.click(menuButton);
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
    await userEvent.click(menuButton);
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
    await userEvent.click(menuButton);
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
    await userEvent.click(menuButton);
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
    await userEvent.click(menuButton);
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
