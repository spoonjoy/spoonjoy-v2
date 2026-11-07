import { useState, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Pagination, type PaginationProps } from "~/components/ouro/pagination/pagination";
import { OuroProvider, type OuroLinkComponent } from "~/lib/ouro/ouro-provider";
import { act } from "~/lib/ouro/testing/act";

/** An element's fill as it shows: none when it is the colour behind it, as forced colours make most fills. */
function shownFill(element: Element): string {
  const fill = getComputedStyle(element).backgroundColor;
  if (fill === "transparent" || /rgba\(.*,\s*0\)$/.test(fill)) return "none";
  for (let node = element.parentElement; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    if (color !== "transparent" && !/rgba\(.*,\s*0\)$/.test(color)) return fill === color ? "none" : fill;
  }
  return fill === "rgb(255, 255, 255)" ? "none" : fill;
}


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
      return host.querySelector<HTMLElement>('[data-ouro="pagination"]')!;
    },
    /** The page list as text: numbers, and "…" for a gap. */
    get cells() {
      return [...host.querySelectorAll<HTMLElement>("[data-ouro-pagination-page],[data-ouro-pagination-gap]")].map((cell) => cell.textContent);
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

const href = (target: number) => `/recipes?page=${target}`;

describe("Pagination", () => {
  it("keeps each page's edge under forced colours, which drop its fill", async () => {
    await commands.emulateMedia({ forcedColors: "active" });
    try {
      for (const props of [{ href }, { onPageChange: () => {} }]) {
        await render(<Pagination page={3} pageCount={5} {...props} />);
        const other = [...document.querySelectorAll('[aria-label="Page 2"]')].at(-1)!;
        expect(parseFloat(getComputedStyle(other).borderTopWidth)).toBeGreaterThan(0);
        expect(getComputedStyle(other).borderTopStyle).toBe("solid");
      }
    } finally {
      await commands.emulateMedia({ forcedColors: "none" });
    }
  });

  it("fills the current page so it stands apart from the rest", async () => {
    for (const props of [{ href }, { onPageChange: () => {} }]) {
      await render(<Pagination page={3} pageCount={5} {...props} />);
      const look = (name: string) => {
        const element = [...document.querySelectorAll(`[aria-label="${name}"]`)].at(-1)!;
        return `${getComputedStyle(element).backgroundColor} ${getComputedStyle(element).color}`;
      };
      expect(look("Page 3")).not.toBe(look("Page 2"));
    }
  });

  it("tells the current page from the rest under forced colours, which drop its fill", async () => {
    for (const props of [{ href }, { onPageChange: () => {} }]) {
      // Forced colours first: switched after the render, a transition would still be easing.
      await commands.emulateMedia({ forcedColors: "active" });
      await render(<Pagination page={3} pageCount={5} {...props} />);
      try {
        const look = (name: string) => {
          const element = [...document.querySelectorAll(`[aria-label="${name}"]`)].at(-1)!;
          return `${shownFill(element)} ${getComputedStyle(element).color} ${getComputedStyle(element).borderTopStyle}`;
        };
        expect(look("Page 3")).not.toBe(look("Page 2"));
      } finally {
        await commands.emulateMedia({ forcedColors: "none" });
      }
    }
  });

  it("renders a labelled nav of plain links, with the current page marked", async () => {
    const { nav } = await render(<Pagination page={3} pageCount={5} href={href} />);
    expect(nav.tagName).toBe("NAV");
    expect(nav.getAttribute("aria-label")).toBe("Pagination");
    const current = page.getByRole("link", { name: "Page 3", exact: true });
    await expect.element(current).toHaveAttribute("aria-current", "page");
    await expect.element(current).toHaveAttribute("href", "/recipes?page=3");
    await expect.element(page.getByRole("link", { name: "Page 2", exact: true })).not.toHaveAttribute("aria-current");
    await expect.element(page.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/recipes?page=2");
    await expect.element(page.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/recipes?page=4");
  });

  it("builds hrefs from a string with {page}, which a Server Component can pass", async () => {
    await render(<Pagination page={1} pageCount={3} href="/recipes/page/{page}" />);
    await expect.element(page.getByRole("link", { name: "Page 2", exact: true })).toHaveAttribute("href", "/recipes/page/2");
    await expect.element(page.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/recipes/page/2");
  });

  it("works with no JavaScript: the server HTML holds every link", () => {
    const html = renderToString(<Pagination page={2} pageCount={3} href="?page={page}" />);
    expect(html).toContain('href="?page=1"');
    expect(html).toContain('href="?page=3"');
    expect(html).toMatch(/aria-current="page"[^>]*href="\?page=2"|href="\?page=2"[^>]*aria-current="page"/);
  });

  it("shows every page when they fit", async () => {
    const { cells } = await render(<Pagination page={4} pageCount={7} href={href} />);
    expect(cells).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
  });

  it("shows a gap after the first pages near the start", async () => {
    const { cells } = await render(<Pagination page={2} pageCount={12} href={href} />);
    expect(cells).toEqual(["1", "2", "3", "4", "5", "…", "12"]);
  });

  it("shows a gap on both sides in the middle", async () => {
    const { cells } = await render(<Pagination page={6} pageCount={12} href={href} />);
    expect(cells).toEqual(["1", "…", "5", "6", "7", "…", "12"]);
  });

  it("shows a gap before the last pages near the end", async () => {
    const { cells } = await render(<Pagination page={11} pageCount={12} href={href} />);
    expect(cells).toEqual(["1", "…", "8", "9", "10", "11", "12"]);
  });

  it("shows more neighbours with siblings", async () => {
    const { cells } = await render(<Pagination page={10} pageCount={20} siblings={2} href={href} />);
    expect(cells).toEqual(["1", "…", "8", "9", "10", "11", "12", "…", "20"]);
  });

  it("hides gaps from screen readers", async () => {
    const { host } = await render(<Pagination page={6} pageCount={12} href={href} />);
    for (const gap of host.querySelectorAll("[data-ouro-pagination-gap]")) expect(gap.getAttribute("aria-hidden")).toBe("true");
  });

  it("has no Previous link on the first page and no Next link on the last", async () => {
    const first = await render(<Pagination page={1} pageCount={3} href={href} />);
    expect(page.getByRole("link", { name: "Previous" }).query()).toBeNull();
    const previous = first.host.querySelector("[data-ouro-pagination-previous]")!;
    expect(previous.getAttribute("aria-disabled")).toBe("true");
    expect(previous.textContent).toBe("Previous");
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    const last = await render(<Pagination page={3} pageCount={3} href={href} />);
    expect(page.getByRole("link", { name: "Next" }).query()).toBeNull();
    expect(last.host.querySelector("[data-ouro-pagination-next]")!.getAttribute("aria-disabled")).toBe("true");
  });

  it("renders buttons that call onPageChange", async () => {
    const onPageChange = vi.fn();
    await render(<Pagination page={2} pageCount={5} onPageChange={onPageChange} />);
    expect(page.getByRole("link").query()).toBeNull();
    await expect.element(page.getByRole("button", { name: "Page 2", exact: true })).toHaveAttribute("aria-current", "page");
    await userEvent.click(page.getByRole("button", { name: "Page 4", exact: true }));
    expect(onPageChange).toHaveBeenLastCalledWith(4);
    await userEvent.click(page.getByRole("button", { name: "Previous" }));
    expect(onPageChange).toHaveBeenLastCalledWith(1);
    await userEvent.click(page.getByRole("button", { name: "Next" }));
    expect(onPageChange).toHaveBeenLastCalledWith(3);
  });

  it("disables the Previous and Next buttons at the ends, and they do nothing", async () => {
    const onPageChange = vi.fn();
    await render(<Pagination page={1} pageCount={1} onPageChange={onPageChange} />);
    for (const name of ["Previous", "Next"]) {
      const button = page.getByRole("button", { name });
      await expect.element(button).toHaveAttribute("aria-disabled", "true");
      // Playwright waits for an enabled button before it clicks; force the press a person can still make.
      await userEvent.click(button, { force: true });
    }
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("keeps focus on Previous when it takes the reader to the first page, where it is disabled", async () => {
    function Paged() {
      const [current, setCurrent] = useState(2);
      return <Pagination page={current} pageCount={5} onPageChange={setCurrent} />;
    }
    await render(<Paged />);
    const previous = page.getByRole("button", { name: "Previous" });
    // From the keyboard: WebKit on a Mac does not focus a button it clicks.
    (previous.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(previous).toHaveAttribute("aria-disabled", "true");
    // A disabled button would drop focus to the page; a button that says it is disabled keeps it.
    expect(document.activeElement).toBe(previous.element());
  });

  it("takes every visible and spoken string as a prop", async () => {
    const { nav } = await render(
      <Pagination
        page={2}
        pageCount={3}
        href={href}
        label="Seiten"
        previousLabel="Zurück"
        nextLabel="Weiter"
        pageLabel="Seite {page}"
        summaryLabel="Seite {page} von {pageCount}"
      />,
    );
    expect(nav.getAttribute("aria-label")).toBe("Seiten");
    await expect.element(page.getByRole("link", { name: "Zurück" })).toBeVisible();
    await expect.element(page.getByRole("link", { name: "Weiter" })).toBeVisible();
    await expect.element(page.getByRole("link", { name: "Seite 3", exact: true })).toBeVisible();
    expect(nav.querySelector("[data-ouro-pagination-summary]")!.textContent).toBe("Seite 2 von 3");
  });

  it("routes internal links through OuroProvider's linkComponent", async () => {
    const RouterLink: OuroLinkComponent = (props: ComponentProps<OuroLinkComponent>) => <a data-router="" {...props} />;
    await render(
      <OuroProvider linkComponent={RouterLink}>
        <Pagination page={1} pageCount={2} href={href} />
      </OuroProvider>,
    );
    await expect.element(page.getByRole("link", { name: "Page 2", exact: true })).toHaveAttribute("data-router");
  });

  it("shows only Previous, the summary and Next below 640px", async () => {
    await page.viewport(390, 844);
    const { nav } = await render(<Pagination page={3} pageCount={12} href={href} />);
    const summary = nav.querySelector<HTMLElement>("[data-ouro-pagination-summary]")!;
    await expect.poll(() => getComputedStyle(summary).display).not.toBe("none");
    expect(summary.textContent).toBe("Page 3 of 12");
    expect(summary.getAttribute("aria-current")).toBe("page");
    for (const cell of nav.querySelectorAll<HTMLElement>("[data-ouro-pagination-page]")) {
      expect(getComputedStyle(cell.closest("li")!).display).toBe("none");
    }
    await expect.element(page.getByRole("link", { name: "Previous" })).toBeVisible();
    await expect.element(page.getByRole("link", { name: "Next" })).toBeVisible();
    expect(nav.scrollWidth).toBeLessThanOrEqual(nav.clientWidth);
  });

  it("hides the summary from 640px up", async () => {
    const { nav } = await render(<Pagination page={3} pageCount={12} href={href} />);
    expect(getComputedStyle(nav.querySelector<HTMLElement>("[data-ouro-pagination-summary]")!.closest("li")!).display).toBe("none");
  });

  it("passes className and ref to the nav", async () => {
    let node: HTMLElement | null = null;
    const { nav } = await render(
      <Pagination
        page={1}
        pageCount={2}
        href={href}
        className="mt-6"
        ref={(element) => {
          node = element;
        }}
      />,
    );
    expect(nav.classList.contains("mt-6")).toBe(true);
    expect(node).toBe(nav);
  });

  it("clamps a page out of range and says so", async () => {
    const { cells } = await render(<Pagination page={9} pageCount={3} href={href} />);
    expect(cells).toEqual(["1", "2", "3"]);
    await expect.element(page.getByRole("link", { name: "Page 3", exact: true })).toHaveAttribute("aria-current", "page");
    expect(warn).toHaveBeenCalledWith("[ouro-ui] Pagination: page={9} is outside 1 to 3. Fix: <Pagination page={3} pageCount={3}>.");
  });

  it("treats a pageCount below 1 as one page and says so", async () => {
    const { cells } = await render(<Pagination page={0} pageCount={0} href={href} />);
    expect(cells).toEqual(["1"]);
    expect(warn).toHaveBeenCalledWith("[ouro-ui] Pagination: pageCount={0} is not a count of pages. Fix: <Pagination page={1} pageCount={1}>.");
  });

  it("warns when a string href has no {page}", async () => {
    await render(<Pagination page={1} pageCount={2} href="/recipes" />);
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] Pagination: href="/recipes" has no {page}, so every link goes to one address. Fix: <Pagination href="/recipes?page={page}">.',
    );
    await render(<Pagination page={1} pageCount={2} href="/recipes?sort=new" />);
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] Pagination: href="/recipes?sort=new" has no {page}, so every link goes to one address. Fix: <Pagination href="/recipes?sort=new&page={page}">.',
    );
  });

  it("warns about appearance classes and the props agents guess", async () => {
    const guessed = {
      page: 1,
      pageCount: 2,
      href,
      className: "bg-red-500",
      currentPage: 1,
      totalPages: 2,
      total: 2,
      count: 2,
      onChange: () => {},
    } as unknown as PaginationProps;
    await render(<Pagination {...guessed} />);
    const messages = warn.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(messages).toContain('[ouro-ui] Pagination: "bg-red-500" sets appearance, and className is for layout only. Fix: remove "bg-red-500"; Pagination sets its own look.');
    expect(messages).toContain("[ouro-ui] Pagination: currentPage is not a prop. Fix: <Pagination page={1} pageCount={12}>.");
    expect(messages).toContain("[ouro-ui] Pagination: totalPages is not a prop. Fix: <Pagination page={1} pageCount={12}>.");
    expect(messages).toContain("[ouro-ui] Pagination: total is not a prop; pass the number of pages. Fix: <Pagination page={1} pageCount={Math.ceil(total / pageSize)}>.");
    expect(messages).toContain("[ouro-ui] Pagination: count is not a prop. Fix: <Pagination page={1} pageCount={12}>.");
    expect(messages).toContain("[ouro-ui] Pagination: onChange is not a prop. Fix: <Pagination onPageChange={(page) => …}>.");
  });

  it("throws without a way to change page, and with both", async () => {
    const neither = { page: 1, pageCount: 2 } as unknown as PaginationProps;
    expect(() => renderToString(<Pagination {...neither} />)).toThrow(
      '[ouro-ui] Pagination: needs href or onPageChange. Fix: Pass href="?page={page}" for links, or onPageChange={(page) => …} for buttons.',
    );
    const both = { page: 1, pageCount: 2, href, onPageChange: () => {} } as unknown as PaginationProps;
    expect(() => renderToString(<Pagination {...both} />)).toThrow("[ouro-ui] Pagination: takes href or onPageChange, not both.");
  });
});

describe("Pagination without a page count", () => {
  it("renders Previous and Next only, with hasNextPage enabling Next", async () => {
    const { nav } = await render(<Pagination page={2} hasNextPage href="?page={page}" />);
    await expect.element(page.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "?page=1");
    await expect.element(page.getByRole("link", { name: "Next" })).toHaveAttribute("href", "?page=3");
    expect(nav.querySelectorAll("[data-ouro-pagination-page]").length).toBe(0);
    expect(nav.querySelector("[data-ouro-pagination-summary]")).toBeNull();
    expect(nav.querySelector("[data-ouro-pagination-gap]")).toBeNull();
  });

  it("disables Next on the last page and Previous on the first", async () => {
    const { nav } = await render(<Pagination page={1} href="?page={page}" />);
    expect(page.getByRole("link").elements().length).toBe(0);
    expect(nav.querySelector("[data-ouro-pagination-next]")!.getAttribute("aria-disabled")).toBe("true");
    expect(nav.querySelector("[data-ouro-pagination-previous]")!.getAttribute("aria-disabled")).toBe("true");
  });

  it("pages in place with onPageChange", async () => {
    const onPageChange = vi.fn();
    await render(<Pagination page={3} hasNextPage onPageChange={onPageChange} />);
    await userEvent.click(page.getByRole("button", { name: "Next" }));
    await userEvent.click(page.getByRole("button", { name: "Previous" }));
    expect(onPageChange.mock.calls).toEqual([[4], [2]]);
  });

  it("keeps Previous and Next apart on a phone", async () => {
    await page.viewport(390, 844);
    const { nav } = await render(<Pagination page={2} hasNextPage href="?page={page}" />);
    const previous = nav.querySelector("[data-ouro-pagination-previous]")!.getBoundingClientRect();
    const next = nav.querySelector("[data-ouro-pagination-next]")!.getBoundingClientRect();
    expect(next.left - previous.right).toBeGreaterThan(100);
  });

  it("warns about a page that is not a page number, without a page count", async () => {
    await render(<Pagination page={0} hasNextPage href="?page={page}" />);
    expect(warn).toHaveBeenCalledWith("[ouro-ui] Pagination: page={0} is not a page number. Fix: <Pagination page={1}>.");
    await expect.element(page.getByRole("link", { name: "Next" })).toHaveAttribute("href", "?page=2");
  });

  it("warns when pageCount and hasNextPage come together, and uses pageCount", async () => {
    const both = { page: 2, pageCount: 2, hasNextPage: true, href: "?page={page}" } as unknown as PaginationProps;
    const { nav } = await render(<Pagination {...both} />);
    expect(warn).toHaveBeenCalledWith("[ouro-ui] Pagination: hasNextPage is for a list without a page count; pageCount decides. Fix: <Pagination page={2} pageCount={2}> or <Pagination page={2} hasNextPage>.");
    expect(nav.querySelector("[data-ouro-pagination-next]")!.getAttribute("aria-disabled")).toBe("true");
  });
});

