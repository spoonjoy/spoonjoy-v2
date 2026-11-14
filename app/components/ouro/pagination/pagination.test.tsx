import { useState, type ComponentProps, type CSSProperties, type ReactNode } from "react";
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

  it("server HTML leaves the page list to the sm rule rather than hiding it, before anything is measured", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(<Pagination page={6} pageCount={12} href={href} />);
    const pageItem = host.querySelector("[data-ouro-pagination-page]")!.closest("li")!;
    expect(pageItem.classList.contains("max-sm:hidden")).toBe(true);
    expect(pageItem.classList.contains("hidden")).toBe(false);
    expect(host.querySelector("[data-ouro-pagination-summary]")!.closest("li")!.classList.contains("sm:hidden")).toBe(true);
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

describe("Pagination in a column", () => {
  const navOf = (host: Element) => host.querySelector<HTMLElement>('[data-ouro="pagination"]')!;
  const itemOf = (element: Element) => element.closest("li")!;
  const shown = (element: Element) => getComputedStyle(element).display !== "none";
  const pageItems = (nav: HTMLElement) => [...nav.querySelectorAll<HTMLElement>("[data-ouro-pagination-page]")].map(itemOf);
  const summaryItem = (nav: HTMLElement) => itemOf(nav.querySelector("[data-ouro-pagination-summary]")!);

  /** The page list's width in full, as the component measures it: every cell and the gaps between them. */
  const fullListWidth = (nav: HTMLElement) => {
    const list = nav.querySelector("ul")!;
    const cells = [...list.children].filter((item) => !item.querySelector("[data-ouro-pagination-summary]"));
    return cells.reduce((sum, cell) => sum + cell.getBoundingClientRect().width, 0) + parseFloat(getComputedStyle(list).columnGap) * (cells.length - 1);
  };

  /** Two frames: the observers' first calls, which a change made before them would otherwise stand in for, run at the layout the page had at mount. */
  const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  /** Mounts `node` in a div with `style`, and returns the root to render again. */
  async function mountIn(node: ReactNode, style: CSSProperties) {
    const host = document.createElement("div");
    host.style.padding = "24px";
    document.body.append(host);
    mounted.push(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<div style={style}>{node}</div>));
    return { host, root, nav: navOf(host), column: navOf(host).parentElement! };
  }

  it("shows the summary, not overflowing, in a column too narrow for every page", async () => {
    await page.viewport(1280, 800);
    const { nav, column } = await mountIn(<Pagination page={6} pageCount={12} href={href} />, { width: 420 });
    await expect.poll(() => shown(summaryItem(nav))).toBe(true);
    for (const item of pageItems(nav)) expect(shown(item)).toBe(false);
    expect(nav.scrollWidth).toBeLessThanOrEqual(column.clientWidth);
    await expect.element(page.getByRole("link", { name: "Previous" })).toBeVisible();
    await expect.element(page.getByRole("link", { name: "Next" })).toBeVisible();
  });

  it("shows every page in a wide column", async () => {
    await page.viewport(1280, 800);
    const { nav } = await mountIn(<Pagination page={6} pageCount={12} href={href} />, { width: 1000 });
    await expect.poll(() => pageItems(nav).every(shown)).toBe(true);
    expect(shown(summaryItem(nav))).toBe(false);
  });

  it("keeps its natural width in a shrink-wrapped flex row, showing every page", async () => {
    await page.viewport(1280, 800);
    const { nav } = await mountIn(<Pagination page={6} pageCount={12} href={href} />, { display: "flex" });
    await expect.poll(() => pageItems(nav).every(shown)).toBe(true);
    expect(shown(summaryItem(nav))).toBe(false);
    expect(nav.getBoundingClientRect().width).toBeGreaterThan(300);
  });

  it("switches to the summary when the column narrows, and back when it widens", async () => {
    await page.viewport(1280, 800);
    const { nav, column } = await mountIn(<Pagination page={6} pageCount={12} href={href} />, { width: 1000 });
    await expect.poll(() => pageItems(nav).every(shown)).toBe(true);
    column.style.width = "420px";
    await expect.poll(() => shown(summaryItem(nav))).toBe(true);
    column.style.width = "1000px";
    await expect.poll(() => pageItems(nav).every(shown)).toBe(true);
    expect(shown(summaryItem(nav))).toBe(false);
  });

  it("re-measures when the page count changes while the summary shows", async () => {
    await page.viewport(1280, 800);
    const { root, nav } = await mountIn(<Pagination page={1} pageCount={12} href={href} />, { width: 420 });
    await expect.poll(() => shown(summaryItem(nav))).toBe(true);
    await act(async () => root.render(<div style={{ width: 420 }}><Pagination page={1} pageCount={5} href={href} /></div>));
    await expect.poll(() => pageItems(nav).every(shown)).toBe(true);
    expect(shown(summaryItem(nav))).toBe(false);
    await act(async () => root.render(<div style={{ width: 420 }}><Pagination page={1} pageCount={12} href={href} /></div>));
    await expect.poll(() => shown(summaryItem(nav))).toBe(true);
  });

  it("moves focus to Next when the page number that has it is replaced by the summary", async () => {
    await page.viewport(1280, 800);
    const { nav, column } = await mountIn(<Pagination page={6} pageCount={12} href={href} />, { width: 1000 });
    const seven = pageItems(nav).map((item) => item.querySelector<HTMLElement>("a")!).find((link) => link.textContent === "7")!;
    seven.focus();
    expect(document.activeElement).toBe(seven);
    column.style.width = "420px";
    await expect.poll(() => document.activeElement).toBe(nav.querySelector("[data-ouro-pagination-next]"));
  });

  it("moves focus to Previous when the summary replaces the last page, where Next is disabled", async () => {
    await page.viewport(1280, 800);
    const { nav, column } = await mountIn(<Pagination page={12} pageCount={12} href={href} />, { width: 1000 });
    const eleven = pageItems(nav).map((item) => item.querySelector<HTMLElement>("a")!).find((link) => link.textContent === "11")!;
    eleven.focus();
    column.style.width = "420px";
    await expect.poll(() => document.activeElement).toBe(nav.querySelector("[data-ouro-pagination-previous]"));
  });

  it("keeps its fit when a font loads, and measures nothing once unmounted", async () => {
    await page.viewport(1280, 800);
    const { root, nav } = await mountIn(<Pagination page={6} pageCount={12} href={href} />, { width: 420 });
    await expect.poll(() => shown(summaryItem(nav))).toBe(true);
    document.fonts.dispatchEvent(new Event("loading"));
    await document.fonts.ready;
    expect(shown(summaryItem(nav))).toBe(true);
    document.fonts.dispatchEvent(new Event("loading"));
    await act(async () => root.unmount());
    roots.splice(roots.indexOf(root), 1);
    await document.fonts.ready;
  });

  it("measures again when a font loads and the labels are wider than they were measured", async () => {
    await page.viewport(1280, 800);
    const { nav, column } = await mountIn(<Pagination page={6} pageCount={12} href={href} />, { width: 500 });
    await expect.poll(() => pageItems(nav).every(shown)).toBe(true);
    await settle();
    // Letter spacing is inherited, so the labels widen while the column and the nav keep their sizes, and no observer fires.
    column.style.letterSpacing = "5px";
    document.fonts.dispatchEvent(new Event("loading"));
    await expect.poll(() => shown(summaryItem(nav))).toBe(true);
  });

  it("measures again once the fonts are ready after mount", async () => {
    await page.viewport(1280, 800);
    let resolve!: (fonts: FontFaceSet) => void;
    const ready = new Promise<FontFaceSet>((done) => (resolve = done));
    Object.defineProperty(document.fonts, "ready", { configurable: true, get: () => ready });
    try {
      const { nav, column } = await mountIn(<Pagination page={6} pageCount={12} href={href} />, { width: 500 });
      await expect.poll(() => pageItems(nav).every(shown)).toBe(true);
      await settle();
      column.style.letterSpacing = "5px";
      resolve(document.fonts);
      await expect.poll(() => shown(summaryItem(nav))).toBe(true);
    } finally {
      Reflect.deleteProperty(document.fonts, "ready");
    }
  });

  it("stops listening for fonts when it unmounts, and measures nothing when a font loads after", async () => {
    await page.viewport(1280, 800);
    const { root } = await mountIn(<Pagination page={6} pageCount={12} href={href} />, { width: 420 });
    const removeListener = vi.spyOn(document.fonts, "removeEventListener");
    try {
      document.fonts.dispatchEvent(new Event("loading"));
      await act(async () => root.unmount());
      roots.splice(roots.indexOf(root), 1);
      expect(removeListener).toHaveBeenCalledWith("loading", expect.any(Function));
      await document.fonts.ready;
    } finally {
      removeListener.mockRestore();
    }
  });

  it("re-measures when the viewport widens while the column stays the same width", async () => {
    await page.viewport(390, 844);
    const { nav } = await mountIn(<Pagination page={6} pageCount={12} href={href} />, { width: 420 });
    await settle();
    await page.viewport(1280, 800);
    await expect.poll(() => shown(summaryItem(nav))).toBe(true);
  });

  it("shows the summary when the only page has focus and neither Next nor Previous can take it", async () => {
    await page.viewport(1280, 800);
    const { nav, column } = await mountIn(<Pagination page={1} pageCount={1} href={href} />, { width: 1000 });
    nav.querySelector<HTMLElement>("[data-ouro-pagination-page]")!.focus();
    column.style.width = "150px";
    await expect.poll(() => shown(summaryItem(nav))).toBe(true);
  });

  it("moves focus to Next without scrolling the page's scroller", async () => {
    await page.viewport(1280, 800);
    const { nav, column } = await mountIn(
      <div style={{ width: 300, overflow: "auto" }}>
        <div style={{ width: 1000 }}>
          <Pagination page={6} pageCount={12} href={href} />
        </div>
      </div>,
      {},
    );
    const scroller = column.parentElement!;
    const seven = pageItems(nav).map((item) => item.querySelector<HTMLElement>("a")!).find((link) => link.textContent === "7")!;
    // The test's own focus must not scroll: WebKit can reveal the focused link after the reset below.
    seven.focus({ preventScroll: true });
    scroller.scrollLeft = 0;
    column.style.width = "420px";
    await expect.poll(() => document.activeElement).toBe(nav.querySelector("[data-ouro-pagination-next]"));
    expect(scroller.scrollLeft).toBe(0);
  });

  it("fits the pages to the column's room less its padding and the nav's margins, to the pixel", async () => {
    await page.viewport(1280, 800);
    const { nav, column } = await mountIn(<Pagination className="mx-2" page={6} pageCount={12} href={href} />, { width: 1000, paddingLeft: 8, paddingRight: 8 });
    await expect.poll(() => pageItems(nav).every(shown)).toBe(true);
    const full = Math.round(fullListWidth(nav));
    // The room is the column's width less 8px of padding and 8px of margin on each side: 32px in all.
    column.style.width = `${full - 4 + 32}px`;
    await expect.poll(() => shown(summaryItem(nav))).toBe(true);
    column.style.width = `${full + 32}px`;
    await expect.poll(() => pageItems(nav).every(shown)).toBe(true);
    expect(shown(summaryItem(nav))).toBe(false);
  });

  it("keeps every page at the room's exact edge, and brings them back there after the summary", async () => {
    await page.viewport(1280, 800);
    const { nav, column } = await mountIn(<Pagination page={6} pageCount={12} href={href} />, { width: 1000 });
    await expect.poll(() => pageItems(nav).every(shown)).toBe(true);
    // The room is the column's width plus half a pixel, so widen the first page by the rest to lay the list out exactly that wide.
    const room = Math.ceil(fullListWidth(nav));
    pageItems(nav)[0]!.style.paddingRight = `${room + 0.5 - fullListWidth(nav)}px`;
    expect(fullListWidth(nav)).toBe(room + 0.5);
    column.style.width = `${room}px`;
    await settle();
    expect(pageItems(nav).every(shown)).toBe(true);
    expect(shown(summaryItem(nav))).toBe(false);
    column.style.width = "420px";
    await expect.poll(() => shown(summaryItem(nav))).toBe(true);
    column.style.width = `${room}px`;
    await expect.poll(() => pageItems(nav).every(shown)).toBe(true);
    expect(shown(summaryItem(nav))).toBe(false);
  });

  it("does not measure the pages on a phone, so their classes stay as the sm rule has them", async () => {
    await page.viewport(390, 844);
    const { nav, column } = await mountIn(<Pagination className="mx-2" page={25} pageCount={50} href={href} />, { width: 1000 });
    await settle();
    const widthOf = (selector: string) => itemOf(nav.querySelector(selector)!).getBoundingClientRect().width;
    const expectSmClasses = () => {
      expect(summaryItem(nav).classList.contains("sm:hidden")).toBe(true);
      for (const item of pageItems(nav)) {
        expect(item.classList.contains("max-sm:hidden")).toBe(true);
        expect(item.classList.contains("hidden")).toBe(false);
      }
    };
    // A column no wider than Previous and Next, with the nav's 8px margins on each side. The pages' gaps, which a phone does not measure, would overflow it.
    column.style.width = `${Math.ceil(widthOf("[data-ouro-pagination-previous]") + widthOf("[data-ouro-pagination-next]")) + 16}px`;
    await settle();
    expectSmClasses();
    // Narrower than the margins, the room is negative, and a measure of the hidden list would still find it too small.
    column.style.width = "8px";
    await settle();
    expectSmClasses();
  });

  it("keeps focus on a control outside the pager when the summary replaces the pages", async () => {
    await page.viewport(1280, 800);
    const { host, nav, column } = await mountIn(
      <>
        <Pagination page={6} pageCount={12} href={href} />
        <button type="button" data-test-harness>
          Outside
        </button>
      </>,
      { width: 1000 },
    );
    await expect.poll(() => pageItems(nav).every(shown)).toBe(true);
    const outside = host.querySelector("button")!;
    outside.focus();
    column.style.width = "420px";
    await expect.poll(() => shown(summaryItem(nav))).toBe(true);
    expect(document.activeElement).toBe(outside);
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

