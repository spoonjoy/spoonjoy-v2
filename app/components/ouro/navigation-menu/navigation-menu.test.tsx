import type { ComponentProps, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { NavigationMenu, type NavigationMenuProps } from "~/components/ouro/navigation-menu/navigation-menu";
import { OuroProvider, type OuroLinkComponent } from "~/lib/ouro/ouro-provider";
import { act } from "~/lib/ouro/testing/act";
import { isTransparent } from "~/lib/ouro/testing/color";
import { pressTab } from "~/lib/ouro/testing/tab";

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
  host.style.padding = "24px";
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<OuroProvider linkComponent={StayLink}>{node}</OuroProvider>));
  return {
    host,
    get root() {
      return host.querySelector<HTMLElement>('[data-ouro="navigation-menu"]')!;
    },
  };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await commands.emulateMedia({ reducedMotion: "no-preference" });
  await page.viewport(1024, 768);
});

describe("NavigationMenu current-page marks", () => {
  afterEach(() => document.documentElement.removeAttribute("dir"));

  /**
   * The page link's mark, read once the link's own colour transitions have finished: a pointer
   * that rested on the link (vitest's unhover leaves it at the body's centre, where the next test's
   * menu may be) fades its hover background out over the press utility's 150 ms, and a read inside
   * that fade sees the hover colour, not the mark.
   */
  async function assertMark(current: Element, other: Element, direction: "ltr" | "rtl") {
    await Promise.allSettled(current.getAnimations().map((animation) => animation.finished));
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

  it("marks only the page link once a pointer that rested on it has moved to open a panel", async () => {
    await render(<NavigationMenu label="Main" items={[{ label: "Pricing", href: "/pricing" }, { label: "Recipes", links: [{ label: "Browse", href: "/recipes" }] }]} currentPath="/pricing" />);
    const pricing = page.getByRole("link", { name: "Pricing" }).element();
    await userEvent.hover(pricing);
    await Promise.allSettled(pricing.getAnimations().map((animation) => animation.finished));
    expect(isTransparent(getComputedStyle(pricing).backgroundColor)).toBe(false);
    await userEvent.click(page.getByRole("button", { name: "Recipes" }));
    await expect.element(page.getByRole("link", { name: "Browse" })).toBeVisible();
    await assertMark(pricing, page.getByRole("button", { name: "Recipes" }).element(), "ltr");
  });
  for (const direction of ["ltr", "rtl"] as const) {
    it(`marks only the page link while a ${direction} panel is open`, async () => {
      document.documentElement.dir = direction;
      await render(<NavigationMenu label="Main" items={[{ label: "Pricing", href: "/pricing" }, { label: "Recipes", links: [{ label: "Browse", href: "/recipes" }] }]} currentPath="/pricing" />);
      await userEvent.click(page.getByRole("button", { name: "Recipes" }));
      await expect.element(page.getByRole("link", { name: "Browse" })).toBeVisible();
      await assertMark(page.getByRole("link", { name: "Pricing" }).element(), page.getByRole("button", { name: "Recipes" }).element(), direction);
    });
    it(`emphasizes its ${direction} current panel label instead of the description`, async () => {
      document.documentElement.dir = direction;
      await render(<NavigationMenu label="Main" items={[{ label: "Recipes", links: [{ label: "Browse", href: "/recipes" }, { label: "Drafts", href: "/recipes/drafts", description: "Unfinished recipes" }] }]} currentPath="/recipes/drafts" />);
      await userEvent.click(page.getByRole("button", { name: "Recipes" }));
      const current = page.getByRole("link", { name: /^Drafts/ });
      await expect.element(current).toBeVisible();
      await assertMark(current.element(), page.getByRole("link", { name: "Browse" }).element(), direction);
      const [label, description] = current.element().querySelectorAll("span");
      expect(getComputedStyle(label!).fontWeight).toBe("600");
      expect(getComputedStyle(description!).fontWeight).toBe("400");
    });
  }
});
afterEach(async () => {
  vi.restoreAllMocks();
  await userEvent.unhover(document.body);
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
  await commands.emulateMedia({ reducedMotion: "no-preference" });
  await page.viewport(414, 896);
});

const items = [
  {
    label: "Recipes",
    links: [
      { label: "Browse", href: "/recipes", description: "Everything you have saved." },
      { label: "Drafts", href: "/recipes/drafts", description: "Recipes you have not finished." },
      { label: "Import", href: "/recipes/import" },
    ],
  },
  {
    label: "Cookbooks",
    links: [
      { label: "Yours", href: "/cookbooks" },
      { label: "Shared with you", href: "/cookbooks/shared" },
    ],
  },
  { label: "Pricing", href: "/pricing" },
];

const popup = () => document.querySelector<HTMLElement>('[data-ouro="navigation-menu-popup"]');

/** Waits until the popup's transitions have finished. */
async function settled() {
  await expect.poll(() => document.getAnimations().length).toBe(0);
}

describe("NavigationMenu", () => {
  it("keeps each trigger's and link's edge under forced colours, which drop their fill", async () => {
    // Forced colours first: switched after the render, a transition would still be easing.
    await commands.emulateMedia({ forcedColors: "active" });
    try {
      await render(<NavigationMenu label="Main" items={items} />);
      for (const element of [page.getByRole("button", { name: "Recipes" }).element(), page.getByRole("link", { name: "Pricing" }).element()]) {
        expect(parseFloat(getComputedStyle(element).borderTopWidth)).toBeGreaterThan(0);
        expect(getComputedStyle(element).borderTopStyle).toBe("solid");
      }
    } finally {
      await commands.emulateMedia({ forcedColors: "none" });
    }
  });

  it("renders a named nav with a button for each panel and a link for each page", async () => {
    const { root } = await render(<NavigationMenu label="Main" items={items} />);
    expect(root.tagName).toBe("NAV");
    expect(root.getAttribute("aria-label")).toBe("Main");
    await expect.element(page.getByRole("button", { name: "Recipes" })).toHaveAttribute("aria-expanded", "false");
    await expect.element(page.getByRole("button", { name: "Cookbooks" })).toBeVisible();
    const pricing = page.getByRole("link", { name: "Pricing" });
    await expect.element(pricing).toHaveAttribute("href", "/pricing");
    await expect.element(pricing).toHaveAttribute("data-router");
    expect(popup()).toBeNull();
  });

  it("opens a panel of links on click, with each link's description", async () => {
    await render(<NavigationMenu label="Main" items={items} />);
    const trigger = page.getByRole("button", { name: "Recipes" });
    await userEvent.click(trigger);
    await expect.element(trigger).toHaveAttribute("aria-expanded", "true");
    const browse = page.getByRole("link", { name: /Browse/ });
    await expect.element(browse).toBeVisible();
    await expect.element(browse).toHaveAttribute("href", "/recipes");
    await expect.element(browse).toHaveAttribute("data-router");
    await expect.element(page.getByText("Everything you have saved.")).toBeVisible();
    expect(page.getByRole("link").elements().map((link) => link.textContent)).toContain("Import");
    await expect.poll(() => popup()!.getBoundingClientRect().width).toBeGreaterThan(200);
    await expect.poll(() => popup()!.getBoundingClientRect().height).toBeGreaterThan(100);
    await settled();
    const box = popup()!.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(trigger.element().getBoundingClientRect().bottom);
  });

  it("opens on hover with a mouse and switches panels", async () => {
    await render(<NavigationMenu label="Main" items={items} />);
    await userEvent.hover(page.getByRole("button", { name: "Recipes" }));
    await expect.element(page.getByRole("link", { name: /Drafts/ })).toBeVisible();
    // While the pointer rests on the first button, Base UI keeps a path to its panel clear by
    // blocking pointer events around it, so move without Playwright's hit-target check.
    // The first move onto the second button lifts the block, and a browser may not report the
    // pointer as over the button until it moves again, as a hand does. So move until it opens.
    let x = 4;
    await expect
      .poll(async () => {
        await userEvent.hover(page.getByRole("button", { name: "Cookbooks" }), { force: true, position: { x: (x += 2), y: 10 } });
        return page.getByRole("link", { name: "Shared with you" }).elements().length;
      })
      .toBe(1);
    await expect.element(page.getByRole("link", { name: "Shared with you" })).toBeVisible();
    await expect.poll(() => page.getByRole("link", { name: /Drafts/ }).elements().length).toBe(0);
  });

  it("closes on Escape and returns focus to the button", async () => {
    await render(<NavigationMenu label="Main" items={items} />);
    const trigger = page.getByRole("button", { name: "Recipes" });
    await userEvent.click(trigger);
    await expect.element(page.getByRole("link", { name: /Browse/ })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => popup()).toBeNull();
    await expect.element(trigger).toHaveFocus();
    await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("opens from the keyboard and tabs into the panel's links", async () => {
    await render(<NavigationMenu label="Main" items={items} />);
    const trigger = page.getByRole("button", { name: "Recipes" });
    trigger.element().focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("link", { name: /Browse/ })).toBeVisible();
    await settled();
    await pressTab();
    await expect.element(page.getByRole("link", { name: /Browse/ })).toHaveFocus();
  });

  it("closes when a link in the panel is chosen", async () => {
    await render(<NavigationMenu label="Main" items={items} />);
    await userEvent.click(page.getByRole("button", { name: "Recipes" }));
    await settled();
    await userEvent.click(page.getByRole("link", { name: /Drafts/ }));
    await expect.poll(() => popup()).toBeNull();
  });

  it("marks the current page from currentPath, on a link and inside a panel", async () => {
    const top = await render(<NavigationMenu label="Main" items={items} currentPath="/pricing" />);
    await expect.element(page.getByRole("link", { name: "Pricing" })).toHaveAttribute("aria-current", "page");
    expect(top.root.querySelector("[data-current]")).toBeNull();
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    mounted.splice(0).forEach((node) => node.remove());
    await render(<NavigationMenu label="Main" items={items} currentPath="/recipes/drafts/4" />);
    await expect.element(page.getByRole("link", { name: "Pricing" })).not.toHaveAttribute("aria-current");
    const trigger = page.getByRole("button", { name: "Recipes" });
    await expect.element(trigger).toHaveAttribute("data-current");
    await expect.element(page.getByRole("button", { name: "Cookbooks" })).not.toHaveAttribute("data-current");
    await userEvent.click(trigger);
    await expect.element(page.getByRole("link", { name: /Drafts/ })).toHaveAttribute("aria-current", "page");
    await expect.element(page.getByRole("link", { name: /Browse/ })).not.toHaveAttribute("aria-current");
  });

  it("lets a link's own current win over currentPath", async () => {
    await render(<NavigationMenu label="Main" items={[{ label: "Home", href: "/" }, { label: "Pricing", href: "/pricing", current: true }]} currentPath="/" />);
    await expect.element(page.getByRole("link", { name: "Pricing" })).toHaveAttribute("aria-current", "page");
    await expect.element(page.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("puts the buttons and the top-level links in the server HTML", () => {
    const html = renderToString(<NavigationMenu label="Main" items={items} currentPath="/pricing" />);
    expect(html).toContain('aria-label="Main"');
    expect(html).toMatch(/<button[^>]*>Recipes/);
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>Pricing<\/a>/);
  });

  it("animates only opacity and scale when a pointer opens it, growing from its button", async () => {
    await render(<NavigationMenu label="Main" items={items} />);
    await userEvent.click(page.getByRole("button", { name: "Recipes" }));
    await expect.poll(() => popup()).not.toBeNull();
    // Base UI turns transitions off for a moment while it measures the panel, so wait.
    await expect.poll(() => getComputedStyle(popup()!).transitionProperty).toBe("opacity, scale");
    expect(getComputedStyle(popup()!).transitionTimingFunction).toContain("cubic-bezier(0.23, 1, 0.32, 1)");
    expect(popup()!.className).toContain("origin-(--transform-origin)");
    // The popup's box and place change at once between panels: layout does not animate.
    expect(getComputedStyle(popup()!.parentElement!).transitionDuration).toBe("0s");
  });

  it("does not animate when the keyboard opens and closes it", async () => {
    await render(<NavigationMenu label="Main" items={items} />);
    const trigger = page.getByRole("button", { name: "Recipes" });
    trigger.element().focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => popup()).not.toBeNull();
    expect(popup()!.hasAttribute("data-ouro-instant")).toBe(true);
    await settled();
    expect(getComputedStyle(popup()!).transitionProperty).toBe("none");
    expect(getComputedStyle(trigger.element().querySelector("svg")!.parentElement!).transitionProperty).toBe("none");
    expect(popup()!.getAnimations({ subtree: true }).length).toBe(0);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => popup()).toBeNull();
    // A pointer animates it again.
    await userEvent.click(trigger);
    await expect.poll(() => popup()).not.toBeNull();
    expect(popup()!.hasAttribute("data-ouro-instant")).toBe(false);
    await expect.poll(() => getComputedStyle(popup()!).transitionProperty).toBe("opacity, scale");
  });

  it("fades without moving under reduced motion", async () => {
    await commands.emulateMedia({ reducedMotion: "reduce" });
    await render(<NavigationMenu label="Main" items={items} />);
    await userEvent.click(page.getByRole("button", { name: "Recipes" }));
    await expect.poll(() => popup()).not.toBeNull();
    // Nothing but opacity may run a transition: a property that moves has no duration.
    const moves = (element: Element) => {
      const style = getComputedStyle(element);
      return /transform|scale|rotate|translate|width|height|top|left|all/.test(style.transitionProperty) && parseFloat(style.transitionDuration) > 0;
    };
    await expect.poll(() => getComputedStyle(popup()!).transitionProperty).toBe("opacity");
    expect(moves(popup()!.parentElement!)).toBe(false);
    expect(moves(page.getByRole("button", { name: "Recipes" }).element().querySelector("svg")!.parentElement!)).toBe(false);
  });

  it("keeps the panel inside a narrow screen", async () => {
    await page.viewport(390, 844);
    await render(<NavigationMenu label="Main" items={items} />);
    await userEvent.click(page.getByRole("button", { name: "Cookbooks" }));
    await expect.poll(() => popup()).not.toBeNull();
    await settled();
    const box = popup()!.getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(390);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  });

  it("passes className and ref to the nav", async () => {
    let node: HTMLElement | null = null;
    const { root } = await render(
      <NavigationMenu
        label="Main"
        items={items}
        className="ms-4"
        ref={(element) => {
          node = element;
        }}
      />,
    );
    expect(root.classList.contains("ms-4")).toBe(true);
    expect(node).toBe(root);
  });

  it("warns about appearance classes and the props agents guess", async () => {
    const guessed = { label: "Main", items, className: "bg-white", links: [], pathname: "/", orientation: "vertical", children: "x" } as unknown as NavigationMenuProps;
    await render(<NavigationMenu {...guessed} />);
    const messages = warn.mock.calls.map((call: unknown[]) => String(call[0]));
    const example = '<NavigationMenu label="Main" items={[{ label: "Recipes", links: [{ label: "Browse", href: "/recipes" }] }, { label: "Pricing", href: "/pricing" }]} />';
    expect(messages).toContain('[ouro-ui] NavigationMenu: "bg-white" sets appearance, and className is for layout only. Fix: remove "bg-white"; NavigationMenu sets its own look.');
    expect(messages).toContain(`[ouro-ui] NavigationMenu: links is not a prop. Fix: ${example}.`);
    expect(messages).toContain("[ouro-ui] NavigationMenu: pathname is not a prop. Fix: <NavigationMenu currentPath={pathname}>.");
    expect(messages).toContain("[ouro-ui] NavigationMenu: orientation is not a prop; the menu is a row. Fix: <Sidebar> for a column of links.");
    expect(messages).toContain(`[ouro-ui] NavigationMenu: children are not rendered; the menu is data. Fix: ${example}.`);
  });

  it("warns when the label is missing, and when an item is both a link and a panel", async () => {
    const odd = { items: [{ label: "Recipes", href: "/recipes", links: [{ label: "Browse", href: "/recipes" }] }] } as unknown as NavigationMenuProps;
    await render(<NavigationMenu {...odd} />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] NavigationMenu: label is required; it names the navigation for screen readers. Fix: <NavigationMenu label="Main">.');
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] NavigationMenu: "Recipes" has both href and a panel, and renders as a panel. Fix: { label: "Recipes", links: [{ label: "All recipes", href: "/recipes" }, …] }.',
    );
    await expect.element(page.getByRole("button", { name: "Recipes" })).toBeVisible();
  });

  it("warns about a panel with no links and no content", async () => {
    const empty = { label: "Main", items: [{ label: "Recipes" }] } as unknown as NavigationMenuProps;
    await render(<NavigationMenu {...empty} />);
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] NavigationMenu: "Recipes" has no href, links or content. Fix: { label: "Recipes", href: "/…" } or { label: "Recipes", links: [{ label, href }] }.',
    );
  });
});

describe("NavigationMenu panels and easing", () => {
  it("eases on the theme's --ouro-ease-out token, with no curve of its own", async () => {
    await render(<NavigationMenu label="Main" items={items} />);
    await userEvent.click(page.getByRole("button", { name: "Recipes" }));
    await expect.poll(() => getComputedStyle(popup()!).transitionProperty).toBe("opacity, scale");
    expect(popup()!.className).toContain("ease-(--ouro-ease-out)");
    expect(document.querySelector('[data-ouro="navigation-menu"]')!.outerHTML + popup()!.outerHTML).not.toContain("cubic-bezier");
    expect(getComputedStyle(popup()!).transitionTimingFunction).toContain("cubic-bezier(0.23, 1, 0.32, 1)");
    document.documentElement.style.setProperty("--ouro-ease-out", "linear");
    try {
      expect(getComputedStyle(popup()!).transitionTimingFunction).toContain("linear");
    } finally {
      document.documentElement.style.removeProperty("--ouro-ease-out");
    }
  });

  const featured = [
    {
      label: "Recipes",
      columns: 2 as const,
      content: (
        <a href="/featured" data-testid="featured">
          Short ribs of the week
        </a>
      ),
      links: [
        { label: "Browse", href: "/recipes" },
        { label: "Drafts", href: "/recipes/drafts" },
        { label: "Import", href: "/recipes/import" },
        { label: "Tags", href: "/recipes/tags" },
      ],
    },
    { label: "Help", content: <p data-testid="help">Write to us any time.</p> },
  ];

  it("shows a panel's content beside its links, in two columns", async () => {
    await render(<NavigationMenu label="Main" items={featured} />);
    await userEvent.click(page.getByRole("button", { name: "Recipes" }));
    await expect.element(page.getByTestId("featured")).toBeVisible();
    // The popup scales in, and WebKit can advance that transition between two reads of a
    // box, so measure once it has finished.
    await settled();
    const card = page.getByTestId("featured").element().getBoundingClientRect();
    const browse = page.getByRole("link", { name: "Browse" }).element().getBoundingClientRect();
    const drafts = page.getByRole("link", { name: "Drafts" }).element().getBoundingClientRect();
    expect(card.right).toBeLessThanOrEqual(browse.left);
    expect(drafts.top).toBe(browse.top);
    expect(drafts.left).toBeGreaterThan(browse.right - 1);
  });

  it("closes when a link in the content is chosen", async () => {
    await render(<NavigationMenu label="Main" items={featured} />);
    await userEvent.click(page.getByRole("button", { name: "Recipes" }));
    await expect.element(page.getByTestId("featured")).toBeVisible();
    page.getByTestId("featured").element().addEventListener("click", (event) => event.preventDefault());
    await userEvent.click(page.getByTestId("featured"));
    await expect.poll(() => popup()).toBeNull();
  });

  it("opens a panel of content alone", async () => {
    await render(<NavigationMenu label="Main" items={featured} />);
    await userEvent.click(page.getByRole("button", { name: "Help" }));
    await expect.element(page.getByTestId("help")).toBeVisible();
    // A click on the content that is not a link leaves the panel open.
    await userEvent.click(page.getByTestId("help"));
    await expect.element(page.getByTestId("help")).toBeVisible();
    expect(popup()).not.toBeNull();
  });

  it("stacks the content above the links on a phone", async () => {
    await page.viewport(390, 844);
    await render(<NavigationMenu label="Main" items={featured} />);
    await userEvent.click(page.getByRole("button", { name: "Recipes" }));
    await expect.element(page.getByTestId("featured")).toBeVisible();
    await expect.poll(() => document.getAnimations().length).toBe(0);
    expect(page.getByTestId("featured").element().getBoundingClientRect().bottom).toBeLessThanOrEqual(page.getByRole("link", { name: "Browse" }).element().getBoundingClientRect().top);
    expect(popup()!.getBoundingClientRect().right).toBeLessThanOrEqual(390);
  });
});
