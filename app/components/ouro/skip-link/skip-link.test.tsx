import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { SkipLink } from "~/components/ouro/skip-link/skip-link";
import { act } from "~/lib/ouro/testing/act";
import { pressTab } from "~/lib/ouro/testing/tab";

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
    get link() {
      return host.querySelector<HTMLAnchorElement>('[data-ouro="skip-link"]')!;
    },
    get main() {
      return host.querySelector<HTMLElement>("main")!;
    },
  };
}

/** A page as an app has it: the skip link first, a header with links, then the main content. */
function Page({ children = <SkipLink />, mainProps = {} }: { children?: ReactNode; mainProps?: Record<string, unknown> }) {
  return (
    <>
      {children}
      <header>
        <a href="/recipes">Recipes</a>
        <a href="/cookbooks">Cookbooks</a>
      </header>
      <main id="main" {...mainProps}>
        <h1>Short ribs</h1>
      </main>
    </>
  );
}

/**
 * Clicks the link with a synthetic event and says whether the component left it to the
 * browser (did not prevent its default). The document's listener, which runs after React's,
 * then stops the browser, so the test page never follows the hash.
 */
function clickLeftToBrowser(link: HTMLAnchorElement, init: MouseEventInit = {}): boolean {
  let left = false;
  const stop = (event: Event) => {
    left = !event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener("click", stop);
  link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
  document.removeEventListener("click", stop);
  return left;
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
});

describe("SkipLink", () => {
  it("is out of sight but read until it has focus, then shows at the top corner", async () => {
    const { link } = await render(<Page />);
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("#main");
    await expect.element(page.getByRole("link", { name: "Skip to main content" })).toBeInTheDocument();
    const hidden = link.getBoundingClientRect();
    expect(hidden.width).toBeLessThanOrEqual(1);
    expect(hidden.height).toBeLessThanOrEqual(1);
    expect(getComputedStyle(link).clipPath).toBe("inset(50%)");
    link.focus();
    await expect.poll(() => link.getBoundingClientRect().width).toBeGreaterThan(40);
    const shown = link.getBoundingClientRect();
    expect(shown.height).toBeGreaterThanOrEqual(36);
    expect(shown.top).toBe(8);
    expect(shown.left).toBe(8);
    expect(getComputedStyle(link).clipPath).toBe("none");
    expect(getComputedStyle(link).position).toBe("fixed");
  });

  it("is the first tab stop, and Enter moves focus to the main content without a history entry", async () => {
    const { link, main } = await render(<Page />);
    const before = document.createElement("button");
    before.textContent = "Before";
    document.body.prepend(before);
    mounted.push(before);
    before.focus();
    await pressTab();
    expect(document.activeElement).toBe(link);
    const length = history.length;
    await userEvent.keyboard("{Enter}");
    expect(document.activeElement).toBe(main);
    expect(main.getAttribute("tabindex")).toBe("-1");
    expect(location.hash).toBe("");
    expect(history.length).toBe(length);
    // Tab from there reaches what follows the main content's start, not the header's links.
    expect(link.getBoundingClientRect().width).toBeLessThanOrEqual(1);
  });

  it("keeps a target's own tabindex", async () => {
    const { link, main } = await render(<Page mainProps={{ tabIndex: 0 }} />);
    link.click();
    expect(document.activeElement).toBe(main);
    expect(main.getAttribute("tabindex")).toBe("0");
  });

  it("skips to another target, and takes its own text", async () => {
    const { link } = await render(
      <>
        <SkipLink target="recipes">Skip to recipes</SkipLink>
        <section id="recipes" aria-label="Recipes" />
      </>,
    );
    expect(link.getAttribute("href")).toBe("#recipes");
    await expect.element(page.getByRole("link", { name: "Skip to recipes" })).toBeInTheDocument();
    link.click();
    expect(document.activeElement).toBe(document.getElementById("recipes"));
  });

  it("leaves a modified click, and a click the app handled, to the browser", async () => {
    const onClick = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
    const { link, main } = await render(<Page>{<SkipLink onClick={onClick} />}</Page>);
    link.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(main);
    await act(async () => roots.at(-1)!.render(<Page />));
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      expect(clickLeftToBrowser(link, init)).toBe(true);
      expect(document.activeElement).not.toBe(main);
    }
  });

  it("lets the browser follow the hash when the target is missing", async () => {
    const { link } = await render(<SkipLink target="nowhere" />);
    warn.mockClear();
    expect(clickLeftToBrowser(link)).toBe(true);
  });

  it("forwards a ref and lets app layout classes win", async () => {
    let element: HTMLAnchorElement | null = null;
    const { link } = await render(<Page>{<SkipLink className="start-8" ref={(node) => void (element = node)} />}</Page>);
    expect(element).toBe(link);
    link.focus();
    await expect.poll(() => link.getBoundingClientRect().left).toBe(32);
  });

  it("does not print", async () => {
    const { link } = await render(<Page />);
    expect(link.className).toContain("print:hidden");
  });
});

describe("SkipLink development messages", () => {
  it.each([
    ["href", { href: "#content" }, "href is not a prop", '<SkipLink target="content" />'],
    ["href", { href: 1 }, "href is not a prop", '<SkipLink target="main" />'],
    ["to", { to: "#main" }, "to is not a prop", '<SkipLink target="main" />'],
    ["label", { label: "Skip" }, "label is not a prop", "<SkipLink>Skip</SkipLink>"],
    ["label", { label: 1 }, "label is not a prop", "<SkipLink>Skip to main content</SkipLink>"],
    ["target", { target: "#main" }, 'target="#main" starts with #', '<SkipLink target="main" />'],
  ])("names the fix for %s", async (_name, extra, problem, fix) => {
    const props = { ...extra } as unknown as Parameters<typeof SkipLink>[0];
    const { link } = await render(<Page>{<SkipLink {...props} />}</Page>);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] SkipLink: ${problem}. Fix: ${fix}.`);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(link.getAttribute("href")).toBe("#main");
    expect(link.hasAttribute("label")).toBe(false);
    expect(link.hasAttribute("to")).toBe(false);
  });

  it("names the target a page lacks once, when the link is used", async () => {
    const { link } = await render(<SkipLink target="content" />);
    expect(warn).not.toHaveBeenCalled();
    clickLeftToBrowser(link);
    clickLeftToBrowser(link);
    expect(warn).toHaveBeenCalledExactlyOnceWith('[ouro-ui] SkipLink: no element has id="content", so the link skips nowhere. Fix: <main id="content">.');
  });

  it.each([
    ["bg-red-500", 'remove "bg-red-500"; SkipLink sets its own look from the theme'],
    ["mt-4", ""],
  ])("checks the className %s", async (className, fix) => {
    await render(<Page>{<SkipLink className={className} />}</Page>);
    if (fix) {
      expect(warn).toHaveBeenCalledWith(`[ouro-ui] SkipLink: "${className}" sets appearance, and className is for layout only. Fix: ${fix}.`);
    } else {
      expect(warn).not.toHaveBeenCalled();
    }
  });

  it("renders to a string without messages", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(<SkipLink target="content" className="bg-red-500" />);
    expect(html).toContain('data-ouro="skip-link"');
    expect(html).toContain('href="#content"');
    expect(html).toContain("Skip to main content");
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
