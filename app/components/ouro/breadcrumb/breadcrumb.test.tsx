import type { ComponentProps, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Breadcrumb, type BreadcrumbProps } from "~/components/ouro/breadcrumb/breadcrumb";
import { OuroProvider, type OuroLinkComponent } from "~/lib/ouro/ouro-provider";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.padding = "24px";
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    get nav() {
      return host.querySelector<HTMLElement>('[data-ouro="breadcrumb"]')!;
    },
    /** The visible trail: each crumb's text, and "…" for the menu button. */
    get trail() {
      return [...host.querySelectorAll<HTMLElement>("[data-ouro-breadcrumb-item]")].map((item) => item.textContent);
    },
  };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await page.viewport(1024, 768);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await page.viewport(414, 896);
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

const short = [{ label: "Home", href: "/" }, { label: "Recipes", href: "/recipes" }, { label: "Short ribs" }];
const long = [
  { label: "Home", href: "/" },
  { label: "Cookbooks", href: "/cookbooks" },
  { label: "Winter", href: "/cookbooks/winter" },
  { label: "Braises", href: "/cookbooks/winter/braises" },
  { label: "Short ribs", href: "/cookbooks/winter/braises/short-ribs" },
  { label: "Edit" },
];

describe("Breadcrumb", () => {
  it("renders a labelled nav with an ordered list of links, the last one the current page", async () => {
    const { nav, trail } = await render(<Breadcrumb items={short} />);
    expect(nav.tagName).toBe("NAV");
    expect(nav.getAttribute("aria-label")).toBe("Breadcrumb");
    expect(nav.querySelector("ol")!.children.length).toBe(3);
    expect(trail).toEqual(["Home", "Recipes", "Short ribs"]);
    await expect.element(page.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    await expect.element(page.getByRole("link", { name: "Recipes" })).toHaveAttribute("href", "/recipes");
    const current = nav.querySelector('[aria-current="page"]')!;
    expect(current.textContent).toBe("Short ribs");
    expect(current.tagName).toBe("SPAN");
  });

  it("renders the current page as text even when it has an href", async () => {
    await render(<Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Recipes", href: "/recipes" }]} />);
    expect(page.getByRole("link", { name: "Recipes" }).query()).toBeNull();
    await expect.element(page.getByText("Recipes")).toHaveAttribute("aria-current", "page");
  });

  it("hides the separators from screen readers, one between each pair", async () => {
    const { nav } = await render(<Breadcrumb items={short} />);
    const separators = nav.querySelectorAll("[data-ouro-breadcrumb-separator]");
    expect(separators.length).toBe(2);
    for (const separator of separators) expect(separator.getAttribute("aria-hidden")).toBe("true");
  });

  it("links the trail in the server HTML", () => {
    const html = renderToString(<Breadcrumb items={short} />);
    expect(html).toContain('href="/recipes"');
    expect(html).toContain('aria-current="page"');
  });

  it("keeps up to four crumbs in full", async () => {
    const { trail } = await render(<Breadcrumb items={long.slice(0, 4)} />);
    expect(trail).toEqual(["Home", "Cookbooks", "Winter", "Braises"]);
    expect(page.getByRole("button", { name: "More" }).query()).toBeNull();
  });

  it("collapses the middle of a long trail into a menu of links", async () => {
    const { trail } = await render(<Breadcrumb items={long} />);
    expect(trail).toEqual(["Home", "…", "Short ribs", "Edit"]);
    expect(page.getByRole("listitem").elements().length).toBe(4);
    await userEvent.click(page.getByRole("button", { name: "More" }));
    const items = page.getByRole("menuitem");
    await expect.poll(() => items.elements().map((item) => item.textContent)).toEqual(["Cookbooks", "Winter", "Braises"]);
    await expect.element(page.getByRole("menuitem", { name: "Winter" })).toHaveAttribute("href", "/cookbooks/winter");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => page.getByRole("menuitem").elements().length).toBe(0);
  });

  it("keeps the More button's edge under forced colours, which drop its fill", async () => {
    await render(<Breadcrumb items={long} />);
    await commands.emulateMedia({ forcedColors: "active" });
    try {
      const more = page.getByRole("button", { name: "More" }).element();
      expect(parseFloat(getComputedStyle(more).borderTopWidth)).toBeGreaterThan(0);
      expect(getComputedStyle(more).borderTopStyle).toBe("solid");
    } finally {
      await commands.emulateMedia({ forcedColors: "none" });
    }
  });

  it("keeps more of the trail with maxItems, and at least the first and the current page", async () => {
    const more = await render(<Breadcrumb items={long} maxItems={5} />);
    expect(more.trail).toEqual(["Home", "…", "Braises", "Short ribs", "Edit"]);
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    const least = await render(<Breadcrumb items={long} maxItems={1} />);
    expect(least.trail).toEqual(["Home", "…", "Edit"]);
  });

  it("takes its spoken strings as props", async () => {
    const { nav } = await render(<Breadcrumb items={long} label="Brotkrumen" moreLabel="Mehr" closeLabel="Schließen" />);
    expect(nav.getAttribute("aria-label")).toBe("Brotkrumen");
    await expect.element(page.getByRole("button", { name: "Mehr" })).toBeVisible();
  });

  it("routes internal links through OuroProvider's linkComponent", async () => {
    const RouterLink: OuroLinkComponent = (props: ComponentProps<OuroLinkComponent>) => <a data-router="" {...props} />;
    await render(
      <OuroProvider linkComponent={RouterLink}>
        <Breadcrumb items={short} />
      </OuroProvider>,
    );
    await expect.element(page.getByRole("link", { name: "Recipes" })).toHaveAttribute("data-router");
  });

  it("renders a crumb without an href as text and says how to link it", async () => {
    const { nav } = await render(<Breadcrumb items={[{ label: "Home" }, { label: "Recipes" }]} />);
    expect(nav.querySelectorAll("a").length).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] Breadcrumb: "Home" has no href; only the last item, the current page, goes without one. Fix: items={[{ label: "Home", href: "/…" }, …]}.',
    );
  });

  it("disables a collapsed crumb without an href in the menu", async () => {
    const items = [long[0]!, { label: "Cookbooks" }, ...long.slice(2)];
    await render(<Breadcrumb items={items} />);
    await userEvent.click(page.getByRole("button", { name: "More" }));
    await expect.element(page.getByRole("menuitem", { name: "Cookbooks" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => page.getByRole("menuitem").elements().length).toBe(0);
  });

  it("renders an empty list for no items", async () => {
    const { nav } = await render(<Breadcrumb items={[]} />);
    expect(nav.querySelector("ol")!.children.length).toBe(0);
  });

  it("passes className and ref to the nav", async () => {
    let node: HTMLElement | null = null;
    const { nav } = await render(
      <Breadcrumb
        items={short}
        className="mb-4"
        ref={(element) => {
          node = element;
        }}
      />,
    );
    expect(nav.classList.contains("mb-4")).toBe(true);
    expect(node).toBe(nav);
  });

  it("wraps on a narrow screen instead of scrolling sideways", async () => {
    await page.viewport(320, 640);
    const { nav } = await render(<Breadcrumb items={long} maxItems={6} />);
    expect(nav.scrollWidth).toBeLessThanOrEqual(nav.clientWidth);
  });

  it("warns about appearance classes and the props agents guess", async () => {
    const guessed = { items: short, className: "text-red-500", links: short, separator: "/", children: "Home" } as unknown as BreadcrumbProps;
    await render(<Breadcrumb {...guessed} />);
    const messages = warn.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(messages).toContain('[ouro-ui] Breadcrumb: "text-red-500" sets appearance, and className is for layout only. Fix: remove "text-red-500"; Breadcrumb sets its own look.');
    expect(messages).toContain('[ouro-ui] Breadcrumb: links is not a prop. Fix: <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Ribs" }]} />.');
    expect(messages).toContain('[ouro-ui] Breadcrumb: separator is not a prop; Breadcrumb draws its own. Fix: <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Ribs" }]} />.');
    expect(messages).toContain('[ouro-ui] Breadcrumb: children are not rendered; the trail is data. Fix: <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Ribs" }]} />.');
  });
});

describe("Breadcrumb icons", () => {
  it("shows a crumb's icon before its label, hidden from screen readers", async () => {
    await render(
      <Breadcrumb
        items={[
          { label: "Home", href: "/", icon: <svg data-testid="home-icon" viewBox="0 0 16 16" /> },
          { label: "Short ribs", icon: <svg data-testid="page-icon" viewBox="0 0 16 16" /> },
        ]}
      />,
    );
    const home = page.getByRole("link", { name: "Home" });
    await expect.element(home).toBeVisible();
    const icon = page.getByTestId("home-icon").element();
    expect(home.element().contains(icon)).toBe(true);
    expect(icon.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(icon.getBoundingClientRect().right).toBeLessThanOrEqual(home.element().getBoundingClientRect().left + home.element().getBoundingClientRect().width / 2);
    expect(page.getByText("Short ribs").element().closest("[aria-current]")!.contains(page.getByTestId("page-icon").element())).toBe(true);
  });
});

