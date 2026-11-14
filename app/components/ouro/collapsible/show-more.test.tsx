import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { ShowMore, type ShowMoreProps } from "~/components/ouro/collapsible/show-more";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.padding = "24px";
  host.style.width = "360px";
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    rerender: (next: ReactNode) => act(async () => root.render(next)),
    get root() {
      return host.querySelector<HTMLElement>('[data-ouro="show-more"]')!;
    },
    get rows() {
      return [...host.querySelectorAll<HTMLLIElement>("li")];
    },
    get button() {
      return host.querySelector<HTMLElement>("[data-ouro-show-more-toggle]");
    },
  };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await commands.emulateMedia({ reducedMotion: "no-preference" });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

const recipes = Array.from({ length: 8 }, (_, index) => `Recipe ${index + 1}`);
const linkRows = recipes.map((title) => (
  <a key={title} href={`#${title}`}>
    {title}
  </a>
));

const longText =
  "Brown the short ribs in batches, then soften the onions, carrots and celery in the fat. " +
  "Stir in the tomato paste, deglaze with red wine, return the ribs, cover with stock and braise " +
  "for three hours, until the meat falls from the bone. Rest overnight, lift off the fat, and " +
  "reheat gently before serving over polenta with gremolata on top.";

describe("ShowMore with items", () => {
  it("shows the first five items in a list, with a Show more button", async () => {
    const { root, rows, button } = await render(<ShowMore items={recipes} />);
    expect(root.getAttribute("data-ouro")).toBe("show-more");
    await expect.element(page.getByRole("list")).toBeVisible();
    expect(rows.map((row) => row.textContent)).toEqual(recipes.slice(0, 5));
    expect(button!.textContent).toBe("Show more");
  });

  it("shows initialCount items and an ordered list with ordered", async () => {
    const { host, rows } = await render(<ShowMore items={recipes} initialCount={3} ordered />);
    expect(rows).toHaveLength(3);
    expect(host.querySelector("ol")).not.toBeNull();
  });

  it("shows no button when every item fits", async () => {
    const { rows, button } = await render(<ShowMore items={recipes.slice(0, 5)} />);
    expect(rows).toHaveLength(5);
    expect(button).toBeNull();
  });

  it("reveals the rest and moves focus to the first new item's link", async () => {
    const { host, rows, button } = await render(<ShowMore items={linkRows} />);
    expect(rows).toHaveLength(5);
    await userEvent.click(button!);
    expect(host.querySelectorAll("li")).toHaveLength(8);
    expect(document.activeElement).toBe(host.querySelectorAll("li")[5]!.querySelector("a"));
    expect(button!.textContent).toBe("Show less");
  });

  it("focuses the first new item itself when it holds nothing focusable", async () => {
    const { host, button } = await render(<ShowMore items={recipes} />);
    await userEvent.click(button!);
    const sixth = host.querySelectorAll("li")[5]!;
    expect(document.activeElement).toBe(sixth);
    expect(sixth.tabIndex).toBe(-1);
  });

  it("fades the new items in, and not the first ones", async () => {
    const { host, button } = await render(<ShowMore items={recipes} />);
    const first = host.querySelector("li")!;
    expect(first.getAnimations()).toHaveLength(0);
    await userEvent.click(button!);
    const sixth = host.querySelectorAll("li")[5]!;
    expect(getComputedStyle(sixth).transitionProperty).toContain("opacity");
    expect(getComputedStyle(first).transitionProperty).not.toContain("opacity");
  });

  it("hides the rest again with Show less and keeps focus on the button", async () => {
    const { host, button } = await render(<ShowMore items={recipes} />);
    await userEvent.click(button!);
    await userEvent.click(button!);
    expect(host.querySelectorAll("li")).toHaveLength(5);
    expect(document.activeElement).toBe(button);
    expect(button!.textContent).toBe("Show more");
  });

  it("takes translated labels", async () => {
    const { button } = await render(<ShowMore items={recipes} showMoreLabel="Mehr anzeigen" showLessLabel="Weniger anzeigen" />);
    expect(button!.textContent).toBe("Mehr anzeigen");
    await userEvent.click(button!);
    expect(button!.textContent).toBe("Weniger anzeigen");
  });

  it("works from the keyboard", async () => {
    const { host, button } = await render(<ShowMore items={linkRows} />);
    button!.focus();
    await userEvent.keyboard("{Enter}");
    expect(document.activeElement).toBe(host.querySelectorAll("li")[5]!.querySelector("a"));
  });

  it("lets app layout classes win and keys rows by their own keys", async () => {
    const { root, rows } = await render(<ShowMore items={linkRows} className="mt-4" />);
    expect(getComputedStyle(root).marginTop).toBe("16px");
    expect(rows[0]!.textContent).toBe("Recipe 1");
  });

  it("renders the visible items in server HTML and hydrates without a mismatch", async () => {
    const node = <ShowMore items={linkRows} />;
    const html = renderToString(node);
    expect(html).toContain("Recipe 5");
    expect(html).not.toContain("Recipe 6");
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    mounted.push(host);
    const recoverable = vi.fn();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(host, node, { onRecoverableError: recoverable });
    });
    roots.push(root);
    expect(recoverable).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    await userEvent.click(host.querySelector<HTMLElement>("[data-ouro-show-more-toggle]")!);
    expect(host.querySelectorAll("li")).toHaveLength(8);
  });
});

/** Finishes the pending load in a `Loading` list, as the server's answer would. */
let finishLoad: () => void = () => {};

/** A list that loads three more recipes after each "Show more", up to `total`, when the test calls `finishLoad`. */
function Loading({ total = 9, onShowMore, wrap = (row) => row }: { total?: number; onShowMore?: () => void; wrap?: (row: ReactElement) => ReactNode }) {
  const [count, setCount] = useState(3);
  const [loading, setLoading] = useState(false);
  return (
    <ShowMore
      items={recipes.concat(["Recipe 9"]).slice(0, count).map((title) =>
        wrap(
          <a key={title} href={`#${title}`}>
            {title}
          </a>,
        ),
      )}
      hasMore={count < total}
      loading={loading}
      href="?after=3"
      onShowMore={() => {
        onShowMore?.();
        setLoading(true);
        finishLoad = () => {
          setCount((value) => Math.min(value + 3, total));
          setLoading(false);
        };
      }}
    />
  );
}

/**
 * What React's Flight client can hand over for an item a Server Component passed: a lazy
 * wrapper with no key, and a new object on every payload.
 */
const fromServer = (row: ReactElement) => ({ $$typeof: Symbol.for("react.lazy"), _payload: row, _init: (payload: unknown) => payload }) as unknown as ReactNode;

describe("ShowMore with items a Server Component passed", () => {
  it("knows an appended page from a replaced list, and focuses the first new item", async () => {
    const { host, button } = await render(<Loading wrap={fromServer} />);
    await userEvent.click(button!);
    await act(async () => finishLoad());
    await expect.poll(() => host.querySelectorAll("li").length).toBe(6);
    await expect.poll(() => document.activeElement).toBe(host.querySelectorAll("li")[3]!.querySelector("a"));
  });

  it("keys each row by its item's own key, so a row keeps its node when the order changes", async () => {
    const rows = (titles: string[]) => titles.map((title) => fromServer(<a key={title} href={`#${title}`}>{title}</a>));
    const host = document.createElement("div");
    document.body.append(host);
    mounted.push(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<ShowMore items={rows(["Pasta", "Salad"])} />));
    const pasta = host.querySelectorAll("li")[0]!;
    expect(pasta.textContent).toBe("Pasta");
    await act(async () => root.render(<ShowMore items={rows(["Salad", "Pasta"])} />));
    expect(host.querySelectorAll("li")[1]).toBe(pasta);
    expect(pasta.textContent).toBe("Pasta");
  });
});

describe("ShowMore loading more", () => {
  it("shows every item and a Show more link to the next page", async () => {
    const { rows, button } = await render(<Loading />);
    expect(rows).toHaveLength(3);
    expect(button!.tagName).toBe("A");
    expect(button!.getAttribute("href")).toBe("?after=3");
  });

  it("calls onShowMore instead of following the link, shows it is busy, then focuses the first new item", async () => {
    const onShowMore = vi.fn();
    const { host, button } = await render(<Loading onShowMore={onShowMore} />);
    await userEvent.click(button!);
    expect(onShowMore).toHaveBeenCalledTimes(1);
    expect(location.search).not.toContain("after");
    expect(button!.getAttribute("aria-busy")).toBe("true");
    await act(async () => finishLoad());
    await expect.poll(() => host.querySelectorAll("li").length).toBe(6);
    await expect.poll(() => document.activeElement).toBe(host.querySelectorAll("li")[3]!.querySelector("a"));
    expect(button!.hasAttribute("aria-busy")).toBe(false);
  });

  it("removes the button on the last page and moves focus to the first new item", async () => {
    const { host } = await render(<Loading total={5} />);
    await userEvent.click(host.querySelector<HTMLElement>("[data-ouro-show-more-toggle]")!);
    await act(async () => finishLoad());
    await expect.poll(() => host.querySelectorAll("li").length).toBe(5);
    expect(host.querySelector("[data-ouro-show-more-toggle]")).toBeNull();
    await expect.poll(() => document.activeElement).toBe(host.querySelectorAll("li")[3]!.querySelector("a"));
  });

  it("moves focus to the last item when the last page comes back empty", async () => {
    const { host } = await render(<Loading total={3} />);
    // hasMore starts false at total 3, so render one with more and an empty answer.
    expect(host.querySelector("[data-ouro-show-more-toggle]")).toBeNull();
    function Empty() {
      const [hasMore, setHasMore] = useState(true);
      return <ShowMore items={["A", "B"]} hasMore={hasMore} onShowMore={() => setHasMore(false)} />;
    }
    const empty = await render(<Empty />);
    await userEvent.click(empty.button!);
    expect(empty.button).toBeNull();
    expect(document.activeElement).toBe(empty.host.querySelectorAll("li")[1]);
  });

  it("renders a button when there is no href, and leaves focus alone when items grow by themselves", async () => {
    const r = await render(<ShowMore items={["A", "B"]} hasMore onShowMore={() => {}} />);
    expect(r.button!.tagName).toBe("BUTTON");
    const before = document.activeElement;
    await r.rerender(<ShowMore items={["A", "B", "C"]} hasMore onShowMore={() => {}} />);
    expect(document.activeElement).toBe(before);
  });

  it("keeps focus on the button while the next page has not arrived", async () => {
    const onShowMore = vi.fn();
    const { button } = await render(<ShowMore items={["A", "B"]} hasMore onShowMore={onShowMore} />);
    await userEvent.click(button!);
    expect(onShowMore).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(button);
  });

  it("does nothing while it is already loading", async () => {
    const onShowMore = vi.fn();
    const { button } = await render(<ShowMore items={["A"]} hasMore loading onShowMore={onShowMore} />);
    // The busy button is disabled, so a real click never lands; a script click must not either.
    await act(async () => button!.click());
    expect(onShowMore).not.toHaveBeenCalled();
  });
});

describe("ShowMore focus after a load that adds nothing", () => {
  type Api = {
    setQuery: (query: string) => void;
    setCount: (count: number) => void;
    setLoading: (loading: boolean) => void;
    setHasMore: (hasMore: boolean) => void;
  };
  let api!: Api;
  function Search({ useLoading = true }: { useLoading?: boolean }) {
    const [query, setQuery] = useState("a");
    const [count, setCount] = useState(3);
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    useEffect(() => {
      api = { setQuery, setCount, setLoading, setHasMore };
    }, []);
    return (
      <div>
        <input aria-label="Search recipes" />
        <ShowMore
          items={Array.from({ length: count }, (_, index) => (
            <a key={`${query}${index}`} href={`#${index}`}>
              Row {index}
            </a>
          ))}
          hasMore={hasMore}
          loading={useLoading ? loading : undefined}
          onShowMore={() => setLoading(true)}
        />
      </div>
    );
  }

  it("stops waiting when a load ends with no new items, so a later change never steals focus", async () => {
    const { host, button } = await render(<Search />);
    await userEvent.click(button!);
    // The load fails: loading ends and no items arrive.
    await act(async () => api.setLoading(false));
    const input = host.querySelector("input")!;
    input.focus();
    // A new search replaces the list with a short last page.
    await act(async () => {
      api.setHasMore(false);
      api.setCount(2);
    });
    expect(document.activeElement).toBe(input);
    await act(async () => api.setCount(6));
    expect(document.activeElement).toBe(input);
  });

  it("stops waiting when the list is replaced by a longer one, without a loading prop", async () => {
    const { host, button } = await render(<Search useLoading={false} />);
    await userEvent.click(button!);
    const input = host.querySelector("input")!;
    input.focus();
    // A new search answers before the page does, with more rows than were shown.
    await act(async () => {
      api.setQuery("b");
      api.setCount(6);
    });
    expect(document.activeElement).toBe(input);
    await act(async () => api.setCount(9));
    expect(document.activeElement).toBe(input);
  });

  it("stops waiting when the list is replaced by a shorter one, without a loading prop", async () => {
    const { host, button } = await render(<Search useLoading={false} />);
    await userEvent.click(button!);
    const input = host.querySelector("input")!;
    input.focus();
    await act(async () => api.setCount(2));
    await act(async () => api.setCount(6));
    expect(document.activeElement).toBe(input);
  });
});

describe("ShowMore from an empty list", () => {
  it("focuses the first item when the first page arrives", async () => {
    function FromEmpty() {
      const [count, setCount] = useState(0);
      const [loading, setLoading] = useState(false);
      return (
        <ShowMore
          items={recipes.slice(0, count).map((title) => (
            <a key={title} href={`#${title}`}>
              {title}
            </a>
          ))}
          hasMore={count < 6}
          loading={loading}
          onShowMore={() => {
            setLoading(true);
            finishLoad = () => {
              setCount(3);
              setLoading(false);
            };
          }}
        />
      );
    }
    const { host, button } = await render(<FromEmpty />);
    expect(host.querySelectorAll("li")).toHaveLength(0);
    await userEvent.click(button!);
    await act(async () => finishLoad());
    await expect.poll(() => host.querySelectorAll("li").length).toBe(3);
    await expect.poll(() => document.activeElement).toBe(host.querySelector("li a"));
    expect(host.querySelector("[data-ouro-show-more-status]")!.textContent).toBe("Showing 3 items");
  });

  it.each([
    ["with", true],
    ["without", false],
  ])("survives a first load that finds nothing, %s a loading prop", async (_name, useLoading) => {
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => void errors.push(event.message);
    window.addEventListener("error", onError);
    const error = vi.spyOn(console, "error").mockImplementation((...args) => void errors.push(String(args[0])));
    function EmptyForever() {
      const [done, setDone] = useState(false);
      const [loading, setLoading] = useState(false);
      return (
        <ShowMore
          items={[]}
          hasMore={!done}
          loading={useLoading ? loading : undefined}
          onShowMore={() => {
            if (!useLoading) return setDone(true);
            setLoading(true);
            finishLoad = () => {
              setDone(true);
              setLoading(false);
            };
          }}
        />
      );
    }
    // The list's name at the moment focus lands on it.
    const namedAtFocus: (string | null)[] = [];
    const onFocus = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      if (target.getAttribute("role") === "list") namedAtFocus.push(target.getAttribute("aria-label"));
    };
    document.addEventListener("focusin", onFocus);
    try {
      const { host, button } = await render(<EmptyForever />);
      await userEvent.click(button!);
      if (useLoading) await act(async () => finishLoad());
      await expect.poll(() => host.querySelector("[data-ouro-show-more-status]")?.textContent).toBe("No more items");
      expect(host.querySelector('[data-ouro="show-more"]')).not.toBeNull();
      expect(host.querySelector("[data-ouro-show-more-toggle]")).toBeNull();
      expect(errors).toEqual([]);
      // Focus never falls to the page: it moves to the empty list, already named when it lands.
      const list = host.querySelector<HTMLElement>('[role="list"]')!;
      expect(document.activeElement).toBe(list);
      expect(namedAtFocus).toEqual(["No more items"]);
      expect(list.getAttribute("tabindex")).toBe("-1");
      expect(list.hasAttribute("aria-labelledby")).toBe(false);
      await expect.element(page.getByRole("list", { name: "No more items" })).toBeInTheDocument();
    } finally {
      window.removeEventListener("error", onError);
      document.removeEventListener("focusin", onFocus);
      error.mockRestore();
    }
  });

  it("focuses the first item without a loading prop too", async () => {
    function FromEmpty() {
      const [count, setCount] = useState(0);
      return <ShowMore items={recipes.slice(0, count)} hasMore={count < 6} onShowMore={() => setCount(3)} />;
    }
    const { host, button } = await render(<FromEmpty />);
    await userEvent.click(button!);
    await expect.poll(() => document.activeElement).toBe(host.querySelector("li"));
  });
});

describe("ShowMore announcements", () => {
  /** Every non-empty text the status region takes, in order. */
  function spoken(host: HTMLElement): string[] {
    const region = host.querySelector<HTMLElement>("[data-ouro-show-more-status]")!;
    const said: string[] = [];
    new MutationObserver(() => {
      if (region.textContent) said.push(region.textContent);
    }).observe(region, { childList: true, characterData: true, subtree: true });
    return said;
  }

  it("says how many items show after each page, through a polite status region", async () => {
    const { host, button } = await render(<Loading />);
    const region = host.querySelector<HTMLElement>("[data-ouro-show-more-status]")!;
    expect(region.getAttribute("role")).toBe("status");
    expect(region.textContent).toBe("");
    // Visually hidden, but read.
    expect(region.getBoundingClientRect().width).toBeLessThanOrEqual(1);
    const said = spoken(host);
    await userEvent.click(button!);
    await act(async () => finishLoad());
    await expect.poll(() => said).toEqual(["Showing 6 items"]);
    await userEvent.click(host.querySelector<HTMLElement>("[data-ouro-show-more-toggle]")!);
    await act(async () => finishLoad());
    await expect.poll(() => said).toEqual(["Showing 6 items", "Showing 9 items"]);
    // The region stays after the button goes, so the last count is still read.
    expect(host.querySelector("[data-ouro-show-more-toggle]")).toBeNull();
    expect(region.isConnected).toBe(true);
  });

  it("takes the words from loadedLabel", async () => {
    const { host, button } = await render(<Loading />);
    await userEvent.click(button!);
    await act(async () => finishLoad());
    await expect.poll(() => host.querySelector("[data-ouro-show-more-status]")!.textContent).toBe("Showing 6 items");
    function Labelled() {
      const [count, setCount] = useState(2);
      return (
        <ShowMore items={recipes.slice(0, count)} hasMore={count < 4} onShowMore={() => setCount(4)} loadedLabel={(shown) => `Showing ${shown} recipes`} />
      );
    }
    const labelled = await render(<Labelled />);
    await userEvent.click(labelled.button!);
    await expect.poll(() => labelled.host.querySelector("[data-ouro-show-more-status]")!.textContent).toBe("Showing 4 recipes");
  });

  it("says there are no more items when a later page comes back empty, in the words of noMoreLabel", async () => {
    function EmptyLast({ noMoreLabel }: { noMoreLabel?: string }) {
      const [count, setCount] = useState(2);
      const [hasMore, setHasMore] = useState(true);
      return (
        <ShowMore
          items={recipes.slice(0, count)}
          hasMore={hasMore}
          noMoreLabel={noMoreLabel}
          onShowMore={() => (count === 2 ? setCount(4) : setHasMore(false))}
        />
      );
    }
    const { host, button } = await render(<EmptyLast />);
    const said = spoken(host);
    await userEvent.click(button!);
    await expect.poll(() => said).toEqual(["Showing 4 items"]);
    await userEvent.click(host.querySelector<HTMLElement>("[data-ouro-show-more-toggle]")!);
    await expect.poll(() => said).toEqual(["Showing 4 items", "No more items"]);
    expect(document.activeElement).toBe(host.querySelectorAll("li")[3]);
    const custom = await render(<EmptyLast noMoreLabel="Keine weiteren Rezepte" />);
    await userEvent.click(custom.button!);
    await userEvent.click(custom.host.querySelector<HTMLElement>("[data-ouro-show-more-toggle]")!);
    await expect.poll(() => custom.host.querySelector("[data-ouro-show-more-status]")!.textContent).toBe("Keine weiteren Rezepte");
  });

  it.each([
    ["with", true],
    ["without", false],
  ])("moves focus to the last item and says no more once when a later page is empty, %s a loading prop", async (_name, useLoading) => {
    function EmptyLater() {
      const [done, setDone] = useState(false);
      const [loading, setLoading] = useState(false);
      return (
        <ShowMore
          items={recipes.slice(0, 3)}
          hasMore={!done}
          loading={useLoading ? loading : undefined}
          onShowMore={() => {
            if (!useLoading) return setDone(true);
            setLoading(true);
            finishLoad = () => {
              setDone(true);
              setLoading(false);
            };
          }}
        />
      );
    }
    const { host, button } = await render(<EmptyLater />);
    const said = spoken(host);
    await userEvent.click(button!);
    if (useLoading) await act(async () => finishLoad());
    await expect.poll(() => document.activeElement).toBe(host.querySelectorAll("li")[2]);
    await expect.poll(() => said).toEqual(["No more items"]);
    expect(document.activeElement).not.toBe(document.body);
    // The list is not focusable while it has items.
    expect(host.querySelector('[role="list"]')!.hasAttribute("tabindex")).toBe(false);
  });

  it("names an empty list only when there is no more to load, never with a stale status", async () => {
    let search!: (items: string[], hasMore: boolean) => void;
    function Results() {
      const [state, setState] = useState({ items: recipes.slice(0, 3), hasMore: true });
      useEffect(() => {
        search = (items, hasMore) => setState({ items, hasMore });
      }, []);
      return (
        <ShowMore
          items={state.items}
          hasMore={state.hasMore}
          onShowMore={() => setState({ items: recipes.slice(0, 6), hasMore: true })}
        />
      );
    }
    const { host, button } = await render(<Results />);
    await userEvent.click(button!);
    await expect.poll(() => host.querySelector("[data-ouro-show-more-status]")!.textContent).toBe("Showing 6 items");
    const list = () => host.querySelector<HTMLElement>('[role="list"]')!;
    // A new search finds nothing, but more may still load: the list is unnamed and not focusable.
    await act(async () => search([], true));
    expect(list().hasAttribute("aria-label")).toBe(false);
    expect(list().hasAttribute("aria-labelledby")).toBe(false);
    expect(list().hasAttribute("tabindex")).toBe(false);
    // Nothing more to load: the empty list is named for that, not "Showing 6 items".
    await act(async () => search([], false));
    expect(list().getAttribute("aria-label")).toBe("No more items");
    expect(list().getAttribute("tabindex")).toBe("-1");
  });

  it("has no status region outside load mode", async () => {
    const { host } = await render(<ShowMore items={recipes} />);
    expect(host.querySelector("[data-ouro-show-more-status]")).toBeNull();
  });
});

describe("ShowMore with lines", () => {
  it("clamps long text to lines and shows Show more", async () => {
    const { root } = await render(<ShowMore lines={2}>{longText}</ShowMore>);
    const text = root.querySelector<HTMLElement>("[data-ouro-show-more-text]")!;
    const lineHeight = parseFloat(getComputedStyle(text).lineHeight);
    expect(text.getBoundingClientRect().height).toBeCloseTo(lineHeight * 2, 0);
    await expect.poll(() => root.querySelector("[data-ouro-show-more-toggle]")).not.toBeNull();
    expect(root.querySelector("[data-ouro-show-more-toggle]")!.textContent).toBe("Show more");
  });

  it("expands to the full text and back, keeping focus on the button", async () => {
    const { root } = await render(<ShowMore lines={2}>{longText}</ShowMore>);
    await expect.poll(() => root.querySelector("[data-ouro-show-more-toggle]")).not.toBeNull();
    const button = root.querySelector<HTMLElement>("[data-ouro-show-more-toggle]")!;
    const text = root.querySelector<HTMLElement>("[data-ouro-show-more-text]")!;
    const clamped = text.getBoundingClientRect().height;
    await userEvent.click(button);
    expect(text.getBoundingClientRect().height).toBeGreaterThan(clamped);
    expect(button.textContent).toBe("Show less");
    expect(document.activeElement).toBe(button);
    await userEvent.click(button);
    expect(text.getBoundingClientRect().height).toBeCloseTo(clamped, 0);
  });

  it("shows no button when the text fits", async () => {
    const { root } = await render(<ShowMore lines={3}>Short note.</ShowMore>);
    await act(async () => {});
    expect(root.querySelector("[data-ouro-show-more-toggle]")).toBeNull();
  });

  it("shows the button once the text stops fitting", async () => {
    const r = await render(<ShowMore lines={2}>Short note.</ShowMore>);
    await r.rerender(<ShowMore lines={2}>{longText}</ShowMore>);
    await expect.poll(() => r.root.querySelector("[data-ouro-show-more-toggle]")).not.toBeNull();
  });

  it("keeps the full text for screen readers and in server HTML", () => {
    const html = renderToString(<ShowMore lines={2}>{longText}</ShowMore>);
    expect(html).toContain("gremolata");
    // Folded by CSS and not guessed: the button waits for the browser's layout.
    expect(html).toContain("line-clamp-");
    expect(html).not.toContain("data-ouro-show-more-toggle");
  });
});

describe("ShowMore with maxHeight", () => {
  const Tall = ({ height, link }: { height: number; link?: boolean }) => (
    <div>
      <a href="#top">Top link</a>
      <div style={{ height }} />
      {link && <a href="#bottom">Bottom link</a>}
    </div>
  );
  const fold = (root: HTMLElement) => root.querySelector<HTMLElement>("[data-ouro-show-more-fold]")!;

  it("folds long content to maxHeight under a fade, with Show more", async () => {
    const { root } = await render(<ShowMore maxHeight={120}><Tall height={400} /></ShowMore>);
    await expect.poll(() => root.querySelector("[data-ouro-show-more-toggle]")?.textContent).toBe("Show more");
    expect(fold(root).getBoundingClientRect().height).toBeCloseTo(120, 0);
    expect(fold(root).getAttribute("data-folded")).toBe("");
    expect(getComputedStyle(fold(root)).maskImage).toContain("linear-gradient");
  });

  it("unfolds to everything and back, keeping focus on the button", async () => {
    const { root } = await render(<ShowMore maxHeight={120}><Tall height={400} /></ShowMore>);
    await expect.poll(() => root.querySelector("[data-ouro-show-more-toggle]")).not.toBeNull();
    const button = root.querySelector<HTMLElement>("[data-ouro-show-more-toggle]")!;
    await userEvent.click(button);
    expect(fold(root).getBoundingClientRect().height).toBeGreaterThan(400);
    expect(fold(root).hasAttribute("data-folded")).toBe(false);
    expect(getComputedStyle(fold(root)).maskImage).toBe("none");
    expect(button.textContent).toBe("Show less");
    expect(document.activeElement).toBe(button);
    await userEvent.click(button);
    expect(fold(root).getBoundingClientRect().height).toBeCloseTo(120, 0);
    expect(button.textContent).toBe("Show more");
    await act(async () => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(document.activeElement).toBe(button);
  });

  it("keeps the page working when it unmounts right after Show less", async () => {
    const { root, rerender } = await render(<ShowMore maxHeight={120}><Tall height={400} /></ShowMore>);
    await expect.poll(() => root.querySelector("[data-ouro-show-more-toggle]")).not.toBeNull();
    const button = root.querySelector<HTMLElement>("[data-ouro-show-more-toggle]")!;
    await userEvent.click(button);
    await act(async () => button.click());
    await rerender(null);
    await act(async () => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(document.querySelector("[data-ouro-show-more-fold]")).toBeNull();
  });

  it("shows content a little taller than maxHeight whole, with no button", async () => {
    const { root } = await render(<ShowMore maxHeight={120}><Tall height={110} /></ShowMore>);
    await expect.poll(() => fold(root).getBoundingClientRect().height).toBeGreaterThan(120);
    expect(root.querySelector("[data-ouro-show-more-toggle]")).toBeNull();
    expect(fold(root).hasAttribute("data-folded")).toBe(false);
  });

  it("folds once the content grows past maxHeight", async () => {
    const r = await render(<ShowMore maxHeight={120}><Tall height={20} /></ShowMore>);
    // A component the guess cannot see starts folded, and shows whole once the browser has laid it out.
    await expect.poll(() => r.root.querySelector("[data-ouro-show-more-toggle]")).toBeNull();
    await r.rerender(<ShowMore maxHeight={120}><Tall height={400} /></ShowMore>);
    await expect.poll(() => r.root.querySelector("[data-ouro-show-more-toggle]")).not.toBeNull();
  });

  it("unfolds when keyboard focus moves into the folded part", async () => {
    // Lower on the page, so the box's own place on the page counts only once.
    const { root } = await render(
      <div style={{ marginTop: 300 }}>
        <ShowMore maxHeight={120} showMoreLabel="Voir plus" showLessLabel="Voir moins"><Tall height={400} link /></ShowMore>
      </div>,
    );
    await expect.poll(() => root.querySelector("[data-ouro-show-more-toggle]")?.textContent).toBe("Voir plus");
    // Focus in the part that shows leaves it folded.
    await act(async () => root.querySelector<HTMLElement>('a[href="#top"]')!.focus());
    expect(fold(root).hasAttribute("data-folded")).toBe(true);
    await act(async () => root.querySelector<HTMLElement>('a[href="#bottom"]')!.focus());
    await expect.poll(() => root.querySelector("[data-ouro-show-more-toggle]")!.textContent).toBe("Voir moins");
    expect(fold(root).getBoundingClientRect().height).toBeGreaterThan(400);
    // Unfolded, focus moves freely.
    await act(async () => root.querySelector<HTMLElement>('a[href="#top"]')!.focus());
    expect(root.querySelector("[data-ouro-show-more-toggle]")!.textContent).toBe("Voir moins");
  });

  it("is folded by CSS in server HTML with all of its content and no guessed fade or button, and hydrates without a mismatch", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const node = <ShowMore maxHeight={120}><Tall height={400} /></ShowMore>;
    const html = renderToString(node);
    expect(html).toContain("Top link");
    expect(html).toContain("max-h-(--ouro-show-more-height)");
    // Nothing is guessed about whether it overflows: the fade and the button wait for the browser's layout.
    expect(html).not.toMatch(/\sdata-folded=/);
    expect(html).not.toContain("data-ouro-show-more-toggle");
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    mounted.push(host);
    const recoverable = vi.fn();
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(host, node, { onRecoverableError: recoverable });
    });
    roots.push(root);
    await expect.poll(() => host.querySelector("[data-ouro-show-more-toggle]")).not.toBeNull();
    expect(recoverable).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("shows content exactly a fifth taller than maxHeight whole", async () => {
    const { root } = await render(<ShowMore maxHeight={120}><div style={{ height: 144 }} /></ShowMore>);
    await expect.poll(() => fold(root).getBoundingClientRect().height).toBeCloseTo(144, 0);
    expect(root.querySelector("[data-ouro-show-more-toggle]")).toBeNull();
  });

  it("measures again when maxHeight changes, and stops measuring once gone", async () => {
    // Every ShowMore shares one observer, which stops watching a ShowMore that is gone.
    const unobserve = vi.spyOn(ResizeObserver.prototype, "unobserve");
    const r = await render(<ShowMore maxHeight={120}><div style={{ height: 200 }} /></ShowMore>);
    await expect.poll(() => r.root.querySelector("[data-ouro-show-more-toggle]")).not.toBeNull();
    await r.rerender(<ShowMore maxHeight={300}><div style={{ height: 200 }} /></ShowMore>);
    await expect.poll(() => r.root.querySelector("[data-ouro-show-more-toggle]")).toBeNull();
    expect(fold(r.root).getBoundingClientRect().height).toBeCloseTo(200, 0);
    const before = unobserve.mock.calls.length;
    await r.rerender(null);
    expect(unobserve.mock.calls.length).toBe(before + 1);
  });

  it("keeps a focused element that ends right at the fold folded", async () => {
    const { root } = await render(
      <ShowMore maxHeight={120}>
        <a href="#edge" style={{ display: "block", height: 120 }}>
          Edge
        </a>
        <div style={{ height: 400 }} />
      </ShowMore>,
    );
    await expect.poll(() => root.querySelector("[data-ouro-show-more-toggle]")).not.toBeNull();
    await act(async () => root.querySelector<HTMLElement>('a[href="#edge"]')!.focus());
    expect(fold(root).hasAttribute("data-folded")).toBe(true);
  });

  it("brings the button back into view after Show less only when it is out of view", async () => {
    const { host } = await render(
      <div data-scroller="" style={{ height: 300, overflowY: "auto" }}>
        <ShowMore maxHeight={120}>
          <div style={{ height: 1000 }} />
        </ShowMore>
        <div style={{ height: 1000 }} />
      </div>,
    );
    const scroller = host.querySelector<HTMLElement>("[data-scroller]")!;
    await expect.poll(() => host.querySelector("[data-ouro-show-more-toggle]")).not.toBeNull();
    const button = host.querySelector<HTMLElement>("[data-ouro-show-more-toggle]")!;
    const frame = () => act(async () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    // Folding back from far below: the button, now above the view, scrolls back in.
    await act(async () => button.click());
    await act(async () => void (scroller.scrollTop = 1100));
    await act(async () => button.click());
    await frame();
    const view = scroller.getBoundingClientRect();
    await expect.poll(() => button.getBoundingClientRect().top).toBeGreaterThanOrEqual(view.top - 1);
    expect(button.getBoundingClientRect().bottom).toBeLessThanOrEqual(view.bottom + 1);
    // Folding back with the button still in view leaves the scroll alone.
    await act(async () => button.click());
    await act(async () => void (scroller.scrollTop = 60));
    await act(async () => button.click());
    await frame();
    expect(scroller.scrollTop).toBe(60);
  });
});

describe("ShowMore toggle semantics", () => {
  it("names the list, the text or the fold it opens and says whether it is open, in every mode that folds", async () => {
    const cases: [ReactElement, string][] = [
      [<ShowMore items={recipes} />, "ul"],
      [<ShowMore lines={2}>{longText}</ShowMore>, "[data-ouro-show-more-text]"],
      [
        <ShowMore maxHeight={120}>
          <div style={{ height: 400 }} />
        </ShowMore>,
        "[data-ouro-show-more-fold]",
      ],
    ];
    for (const [node, region] of cases) {
      const { host, root } = await render(node);
      await expect.poll(() => root.querySelector("[data-ouro-show-more-toggle]")).not.toBeNull();
      const button = root.querySelector<HTMLElement>("[data-ouro-show-more-toggle]")!;
      const folded = root.querySelector<HTMLElement>(region)!;
      expect(folded.id).not.toBe("");
      expect(button.getAttribute("aria-controls")).toBe(folded.id);
      expect(host.querySelectorAll(`[id="${folded.id}"]`)).toHaveLength(1);
      expect(button.getAttribute("aria-expanded")).toBe("false");
      await userEvent.click(button);
      expect(button.getAttribute("aria-expanded")).toBe("true");
      await userEvent.click(button);
      expect(button.getAttribute("aria-expanded")).toBe("false");
    }
  });

  it("gives each ShowMore on a page a region of its own", async () => {
    const { host } = await render(
      <>
        <ShowMore items={recipes} />
        <ShowMore items={recipes} />
      </>,
    );
    const [first, second] = [...host.querySelectorAll<HTMLElement>("[data-ouro-show-more-toggle]")].map((button) => button.getAttribute("aria-controls"));
    expect(first).not.toBe(second);
  });

  it("names the list a load adds to, and claims no open state, since loading more never folds", async () => {
    const { root, button } = await render(<ShowMore items={recipes.slice(0, 3)} hasMore onShowMore={() => {}} href="?after=3" />);
    expect(button!.getAttribute("aria-controls")).toBe(root.querySelector("ul")!.id);
    expect(button!.hasAttribute("aria-expanded")).toBe(false);
  });
});

describe("ShowMore open", () => {
  const clamped = (root: HTMLElement) => {
    const text = root.querySelector<HTMLElement>("[data-ouro-show-more-text]")!;
    return text.getBoundingClientRect().height <= parseFloat(getComputedStyle(text).lineHeight) * 2 + 1;
  };
  const folded = (root: HTMLElement) => root.querySelector("[data-ouro-show-more-fold]")!.getBoundingClientRect().height < 200;
  const toggle = (root: HTMLElement) => root.querySelector<HTMLElement>("[data-ouro-show-more-toggle]");

  it("follows open in each mode, and its buttons ask onOpenChange without changing it", async () => {
    const onOpenChange = vi.fn();
    const items = await render(<ShowMore items={linkRows} open onOpenChange={onOpenChange} />);
    expect(items.rows).toHaveLength(8);
    expect(items.button!.textContent).toBe("Show less");
    await userEvent.click(items.button!);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(items.rows).toHaveLength(8);
    await items.rerender(<ShowMore items={linkRows} open={false} onOpenChange={onOpenChange} />);
    expect(items.rows).toHaveLength(5);
    await userEvent.click(items.button!);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(items.rows).toHaveLength(5);
    // When the app agrees, focus still moves to the first new item.
    await items.rerender(<ShowMore items={linkRows} open onOpenChange={onOpenChange} />);
    expect(items.rows).toHaveLength(8);
    await expect.poll(() => document.activeElement?.textContent).toBe("Recipe 6");

    const lines = await render(<ShowMore lines={2} open onOpenChange={onOpenChange}>{longText}</ShowMore>);
    await expect.poll(() => toggle(lines.root)?.textContent).toBe("Show less");
    expect(clamped(lines.root)).toBe(false);
    await userEvent.click(toggle(lines.root)!);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(clamped(lines.root)).toBe(false);
    await lines.rerender(<ShowMore lines={2} open={false} onOpenChange={onOpenChange}>{longText}</ShowMore>);
    expect(clamped(lines.root)).toBe(true);
    expect(toggle(lines.root)!.textContent).toBe("Show more");
    await userEvent.click(toggle(lines.root)!);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(clamped(lines.root)).toBe(true);

    const tall = (
      <div>
        <div style={{ height: 400 }} />
        <a href="#bottom">Bottom link</a>
      </div>
    );
    const height = await render(<ShowMore maxHeight={120} open onOpenChange={onOpenChange}>{tall}</ShowMore>);
    await expect.poll(() => toggle(height.root)?.textContent).toBe("Show less");
    expect(folded(height.root)).toBe(false);
    await userEvent.click(toggle(height.root)!);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(folded(height.root)).toBe(false);
    await height.rerender(<ShowMore maxHeight={120} open={false} onOpenChange={onOpenChange}>{tall}</ShowMore>);
    expect(folded(height.root)).toBe(true);
    onOpenChange.mockClear();
    // Focus below the fold asks to unfold too.
    await act(async () => height.root.querySelector<HTMLElement>('a[href="#bottom"]')!.focus());
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(folded(height.root)).toBe(true);
  });

  it("tells onOpenChange each change of its own state when open is not set", async () => {
    const onOpenChange = vi.fn();
    const items = await render(<ShowMore items={recipes} onOpenChange={onOpenChange} />);
    await userEvent.click(items.button!);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(items.rows).toHaveLength(8);
    await userEvent.click(items.button!);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(items.rows).toHaveLength(5);

    const lines = await render(<ShowMore lines={2} onOpenChange={onOpenChange}>{longText}</ShowMore>);
    await expect.poll(() => toggle(lines.root)).not.toBeNull();
    await userEvent.click(toggle(lines.root)!);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(clamped(lines.root)).toBe(false);

    const height = await render(<ShowMore maxHeight={120} onOpenChange={onOpenChange}><div style={{ height: 400 }} /></ShowMore>);
    await expect.poll(() => toggle(height.root)).not.toBeNull();
    await userEvent.click(toggle(height.root)!);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(folded(height.root)).toBe(false);
    expect(onOpenChange).toHaveBeenCalledTimes(4);
  });

  it("drops the button when text shown whole no longer needs it", async () => {
    const lines = await render(<ShowMore lines={2} open onOpenChange={() => {}}>{longText}</ShowMore>);
    await expect.poll(() => toggle(lines.root)?.textContent).toBe("Show less");
    await lines.rerender(<ShowMore lines={2} open onOpenChange={() => {}}>Short note.</ShowMore>);
    await expect.poll(() => toggle(lines.root)).toBeNull();
  });
});

describe("ShowMore development messages", () => {
  it.each([
    ["maxLines", { lines: 2, children: longText, maxLines: 2 }, "maxLines is not a prop", "<ShowMore lines={2}>"],
    ["limit", { items: recipes, limit: 3 }, "limit is not a prop", "<ShowMore items={items} initialCount={3}>"],
    ["initialCount", { items: recipes, initialCount: 0 }, "initialCount={0} is not a whole number above 0", "<ShowMore items={items} initialCount={5}>"],
    ["lines", { lines: -1, children: longText }, "lines={-1} is not a whole number above 0", "<ShowMore lines={3}>"],
    ["maxHeight", { maxHeight: 0, children: longText }, "maxHeight={0} is not a number of pixels above 0", "<ShowMore maxHeight={240}>"],
    ["open", { items: recipes, open: true }, "open without onOpenChange: its button can't change it", "<ShowMore open={open} onOpenChange={setOpen}>"],
  ])("warns for %s with the fix", async (_name, extra, problem, fix) => {
    const props = extra as unknown as ShowMoreProps;
    const { root } = await render(<ShowMore {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] ShowMore: ${problem}. Fix: ${fix}.`);
    expect(root.hasAttribute("limit")).toBe(false);
  });

  it("clamps to a guessed maxLines when lines is missing", async () => {
    const { root } = await render(<ShowMore {...({ maxLines: 2, children: longText } as unknown as ShowMoreProps)} />);
    const text = root.querySelector<HTMLElement>("[data-ouro-show-more-text]")!;
    expect(text.getBoundingClientRect().height).toBeCloseTo(parseFloat(getComputedStyle(text).lineHeight) * 2, 0);
    expect(warn).toHaveBeenCalledWith("[ouro-ui] ShowMore: maxLines is not a prop. Fix: <ShowMore lines={2}>.");
  });

  it("uses the default for an invalid initialCount or lines", async () => {
    const items = await render(<ShowMore {...({ items: recipes, initialCount: 0 } as unknown as ShowMoreProps)} />);
    expect(items.rows).toHaveLength(5);
    const lines = await render(<ShowMore {...({ lines: 0, children: longText } as unknown as ShowMoreProps)} />);
    const text = lines.root.querySelector<HTMLElement>("[data-ouro-show-more-text]")!;
    expect(text.getBoundingClientRect().height).toBeCloseTo(parseFloat(getComputedStyle(text).lineHeight) * 3, 0);
  });

  it("warns of nothing when the props are right, in every mode", async () => {
    await render(<ShowMore items={recipes} initialCount={3} />);
    await render(<ShowMore lines={2}>{longText}</ShowMore>);
    await render(<ShowMore maxHeight={120}>{longText}</ShowMore>);
    await render(<ShowMore items={recipes} hasMore={false} onShowMore={() => {}} />);
    await render(<ShowMore items={recipes} open onOpenChange={() => {}} />);
    expect(warn).not.toHaveBeenCalled();
  });

  it("renders a list when items comes with maxHeight", async () => {
    const { rows, root } = await render(<ShowMore {...({ items: recipes, maxHeight: 100 } as unknown as ShowMoreProps)} />);
    expect(rows).toHaveLength(5);
    expect(root.querySelector("[data-ouro-show-more-fold]")).toBeNull();
  });

  it("folds to the default height for an invalid maxHeight", async () => {
    const { root } = await render(<ShowMore {...({ maxHeight: Number.NaN, children: <div style={{ height: 600 }} /> } as unknown as ShowMoreProps)} />);
    await expect.poll(() => root.querySelector("[data-ouro-show-more-toggle]")).not.toBeNull();
    expect(root.querySelector<HTMLElement>("[data-ouro-show-more-fold]")!.getBoundingClientRect().height).toBeCloseTo(240, 0);
  });

  it("checks the className", async () => {
    await render(<ShowMore items={recipes} className="text-sm" />);
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] ShowMore: "text-sm" sets appearance, and className is for layout only. Fix: <div className="text-sm"><ShowMore /></div>.',
    );
  });

  it("points other appearance classes to ShowMore's own look", async () => {
    await render(<ShowMore items={recipes} className="bg-muted" />);
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] ShowMore: "bg-muted" sets appearance, and className is for layout only. Fix: remove "bg-muted"; ShowMore sets its own look.',
    );
  });

  it("renders to a string without warnings", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(<ShowMore items={recipes} className="bg-red-500" />);
    expect(html).toContain('data-ouro="show-more"');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

const settle = () => act(async () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

describe("ShowMore in its first frame", () => {
  /** A component whose content ShowMore cannot see: it renders a block of `height` px. */
  function Opaque({ height = 400 }: { height?: number }) {
    return <div style={{ height }} />;
  }
  const committed = (node: ReactElement) => {
    const host = document.createElement("div");
    host.style.width = "360px";
    document.body.append(host);
    mounted.push(host);
    const root = createRoot(host);
    roots.push(root);
    // The commit alone, before the browser draws a frame.
    flushSync(() => root.render(node));
    return host;
  };
  const toggle = (host: Element) => host.querySelector("[data-ouro-show-more-toggle]");
  const foldOf = (host: Element) => host.querySelector<HTMLElement>("[data-ouro-show-more-fold]")!;
  const textOf = (host: Element) => host.querySelector<HTMLElement>("[data-ouro-show-more-text]")!;

  it.each([
    ["long text", <ShowMore lines={2}>{longText}</ShowMore>],
    ["short text", <ShowMore lines={4}>Hi</ShowMore>],
    ["tall content", <ShowMore maxHeight={120}><Opaque /></ShowMore>],
    ["short content", <ShowMore maxHeight={120}><Opaque height={20} /></ShowMore>],
    ["content an estimate calls short", <ShowMore maxHeight={120} estimate={{ text: "Hi" }}><Opaque /></ShowMore>],
    ["text an estimate calls long", <ShowMore lines={4} estimate={{ text: "word ".repeat(100) }}>Hi</ShowMore>],
    ["text shown whole from the start", <ShowMore lines={2} open>{longText}</ShowMore>],
  ])("with %s, has no button as React commits it, because it guesses nothing about overflow", (_, node) => {
    expect(toggle(committed(node))).toBeNull();
  });

  it("folds by CSS in the first commit, whatever the content", () => {
    const text = committed(<ShowMore lines={2}>{"Hi"}</ShowMore>);
    expect(textOf(text).className).toContain("line-clamp-");
    const tall = committed(<ShowMore maxHeight={120}><Opaque /></ShowMore>);
    expect(foldOf(tall).className).toContain("max-h-");
    expect(foldOf(tall).hasAttribute("data-folded")).toBe(false);
    const short = committed(<ShowMore maxHeight={120}><Opaque height={20} /></ShowMore>);
    expect(foldOf(short).className).toContain("max-h-");
  });

  it("does not move short content or the box of long content when the browser has measured it", async () => {
    const boxes = (host: Element) => [...host.querySelectorAll("[data-ouro-show-more-text],[data-ouro-show-more-fold]")].map((box) => box.getBoundingClientRect().toJSON());
    for (const node of [
      <ShowMore lines={4}>{"Lunch at noon?"}</ShowMore>,
      <ShowMore lines={2}>{longText}</ShowMore>,
      <ShowMore maxHeight={120}><Opaque height={20} /></ShowMore>,
      <ShowMore maxHeight={120}><Opaque /></ShowMore>,
    ]) {
      const host = committed(node);
      const before = boxes(host);
      await settle();
      expect(boxes(host)).toEqual(before);
    }
  });

  it("adds its button to what overflows once the browser has measured it, and to nothing else", async () => {
    const long = committed(<ShowMore lines={2}>{longText}</ShowMore>);
    const tall = committed(<ShowMore maxHeight={120}><Opaque /></ShowMore>);
    const short = committed(<ShowMore lines={4}>Hi</ShowMore>);
    const fits = committed(<ShowMore maxHeight={120}><Opaque height={20} /></ShowMore>);
    await expect.poll(() => toggle(long)).not.toBeNull();
    await expect.poll(() => toggle(tall)).not.toBeNull();
    expect(foldOf(tall).hasAttribute("data-folded")).toBe(true);
    await settle();
    expect(toggle(short)).toBeNull();
    expect(toggle(fits)).toBeNull();
    expect(foldOf(fits).hasAttribute("data-folded")).toBe(false);
  });

  it("has its button and fade in the first frame the browser paints, and nothing for what fits", async () => {
    const long = committed(<ShowMore lines={2}>{longText}</ShowMore>);
    const tall = committed(<ShowMore maxHeight={120}><Opaque /></ShowMore>);
    const short = committed(<ShowMore lines={4}>Hi</ShowMore>);
    const fits = committed(<ShowMore maxHeight={120}><Opaque height={20} /></ShowMore>);
    // Read where the first frame's resize observers run: after the browser has laid the page out, before it paints.
    const painted = await new Promise<boolean[]>((resolve) => {
      const probe = new ResizeObserver(() => {
        probe.disconnect();
        resolve([!!toggle(long), !!toggle(tall), foldOf(tall).hasAttribute("data-folded"), !!toggle(short), !!toggle(fits), foldOf(fits).hasAttribute("data-folded")]);
      });
      probe.observe(document.body);
    });
    expect(painted).toEqual([true, true, true, false, false, false]);
  });

  it("measures many folds with one observer, every one's button in the same first painted frame", async () => {
    committed(<ShowMore maxHeight={120}><Opaque /></ShowMore>);
    const made = vi.spyOn(window, "ResizeObserver");
    const hosts = Array.from({ length: 20 }, (_, i) => committed(i % 2 ? <ShowMore lines={2}>{longText}</ShowMore> : <ShowMore maxHeight={120}><Opaque /></ShowMore>));
    expect(made).not.toHaveBeenCalled();
    made.mockRestore();
    const painted = await new Promise<number>((resolve) => {
      const probe = new ResizeObserver(() => {
        probe.disconnect();
        resolve(hosts.filter((host) => toggle(host)).length);
      });
      probe.observe(document.body);
    });
    expect(painted).toBe(20);
  });

  it("gives text that wraps more in a narrow box its button, once measured", async () => {
    const narrow = committed(
      <div style={{ width: 80 }}>
        <ShowMore lines={4}>{"word ".repeat(20)}</ShowMore>
      </div>,
    );
    expect(toggle(narrow)).toBeNull();
    await expect.poll(() => toggle(narrow)).not.toBeNull();
  });

  it("drops the button of text that, open, takes no more than its lines", async () => {
    const host = committed(<ShowMore lines={2} open>{["a", <br key="b" />, "b"]}</ShowMore>);
    await settle();
    expect(toggle(host)).toBeNull();
  });

  it("keeps the button of text shown whole when its line height is not a length", async () => {
    const host = committed(
      <div style={{ lineHeight: "normal" }}>
        <ShowMore lines={2} open>
          {longText}
        </ShowMore>
      </div>,
    );
    await expect.poll(() => toggle(host)?.textContent).toBe("Show less");
  });
});

describe("ShowMore as its app renders again", () => {
  it("reads no layout when the app renders the same text again, and measures text that changed", async () => {
    const { root, rerender } = await render(<ShowMore lines={2}><>{longText}</></ShowMore>);
    await settle();
    const own = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight")!;
    let reads = 0;
    Object.defineProperty(Element.prototype, "scrollHeight", {
      configurable: true,
      get(this: Element) {
        reads++;
        return own.get!.call(this);
      },
    });
    try {
      // The same text, in new elements, as a parent's render makes them.
      for (let again = 0; again < 5; again++) await rerender(<ShowMore lines={2}><>{longText}</></ShowMore>);
      await settle();
      expect(reads).toBe(0);
      await rerender(<ShowMore lines={2}>Short now.</ShowMore>);
      await expect.poll(() => root.querySelector("[data-ouro-show-more-toggle]")).toBeNull();
      expect(reads).toBeGreaterThan(0);
    } finally {
      Object.defineProperty(Element.prototype, "scrollHeight", own);
    }
  });

  it("starts watching again only when it opens or closes or its lines change", async () => {
    // Every ShowMore shares one observer: what counts is how often this one asks it to watch.
    const observe = vi.spyOn(ResizeObserver.prototype, "observe");
    const host = document.createElement("div");
    document.body.append(host);
    mounted.push(host);
    const root = createRoot(host);
    roots.push(root);
    const render = (node: ReactElement) => act(async () => root.render(node));
    await render(<ShowMore lines={4}>{"Hi"}</ShowMore>);
    const first = observe.mock.calls.length;
    await render(<ShowMore lines={4}>{"word ".repeat(100)}</ShowMore>);
    expect(observe.mock.calls.length).toBe(first);
    await render(<ShowMore lines={3}>{"word ".repeat(100)}</ShowMore>);
    expect(observe.mock.calls.length).toBe(first + 1);
    observe.mockRestore();
  });
});

describe("ShowMore in a long list", () => {
  it.each([
    ["lines", (index: number) => <ShowMore lines={2}>{`${index}: ${longText}`}</ShowMore>],
    [
      "maxHeight",
      (index: number) => (
        <ShowMore maxHeight={120}>
          <p>{`${index}: ${longText}`}</p>
          <div style={{ height: 300 }} />
        </ShowMore>
      ),
    ],
  ])("with %s, mounts 50 folded and reads no layout as it commits, so it never lays the page out once per instance, then gives each its button", async (_, folded) => {
    const host = document.createElement("div");
    document.body.append(host);
    mounted.push(host);
    const root = createRoot(host);
    roots.push(root);
    const reads = { count: 0 };
    const counted: [object, string][] = [
      [Element.prototype, "scrollHeight"],
      [Element.prototype, "clientHeight"],
      [Element.prototype, "scrollWidth"],
      [Element.prototype, "clientWidth"],
      [Element.prototype, "scrollTop"],
      [HTMLElement.prototype, "offsetHeight"],
      [HTMLElement.prototype, "offsetWidth"],
      [HTMLElement.prototype, "offsetTop"],
      [HTMLElement.prototype, "offsetLeft"],
    ];
    const restore = counted.map(([prototype, name]) => {
      const own = Object.getOwnPropertyDescriptor(prototype, name)!;
      Object.defineProperty(prototype, name, {
        configurable: true,
        get(this: Element) {
          reads.count++;
          return own.get!.call(this);
        },
      });
      return () => Object.defineProperty(prototype, name, own);
    });
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect");
    const rects = vi.spyOn(Element.prototype, "getClientRects");
    const style = vi.spyOn(window, "getComputedStyle");
    try {
      flushSync(() => root.render(<div>{Array.from({ length: 50 }, (_, index) => <div key={index}>{folded(index)}</div>)}</div>));
    } finally {
      restore.forEach((undo) => undo());
    }
    expect(reads.count + rect.mock.calls.length + rects.mock.calls.length + style.mock.calls.length).toBe(0);
    expect(host.querySelectorAll("[data-ouro-show-more-toggle]")).toHaveLength(0);
    await expect.poll(() => host.querySelectorAll("[data-ouro-show-more-toggle]").length).toBe(50);
  });
});

describe("ShowMore as a row mounts again", () => {
  const tall = (index: number) => (
    <ShowMore maxHeight={120} measureKey={`message-${index}`}>
      <div style={{ height: 300 }} />
    </ShowMore>
  );
  const clamped = (index: number) => (
    <ShowMore lines={2} measureKey={`text-${index}`}>
      {`${index}: ${longText}`}
    </ShowMore>
  );

  /** Mounts `node` in a fresh host and counts the writes the page sees after the commit: attributes, text and buttons coming and going. */
  async function writesAfterMount(node: ReactElement): Promise<{ writes: number; buttons: number; host: HTMLElement }> {
    const host = document.createElement("div");
    host.style.width = "360px";
    document.body.append(host);
    mounted.push(host);
    const root = createRoot(host);
    roots.push(root);
    flushSync(() => root.render(node));
    const buttons = () => host.querySelectorAll("[data-ouro-show-more-toggle]").length;
    const startedWith = buttons();
    let writes = 0;
    const watch = new MutationObserver((records) => {
      writes += records.length;
    });
    watch.observe(host, { attributes: true, childList: true, subtree: true, characterData: true });
    // Two frames are enough for the resize observer to have measured.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 50));
    watch.disconnect();
    expect(startedWith).toBeLessThanOrEqual(1);
    return { writes, buttons: buttons(), host };
  }

  it.each([
    ["maxHeight", tall, 1],
    ["lines", clamped, 2],
  ])("with %s, a row that mounts again with its measureKey makes no write after its first commit, and a first mount makes some", async (_, row, index) => {
    const first = await writesAfterMount(row(index));
    expect(first.buttons).toBe(1);
    expect(first.writes).toBeGreaterThan(0);
    const again = await writesAfterMount(row(index));
    expect(again.buttons).toBe(1);
    expect(again.writes).toBe(0);
  });

  it("starts a remounted row with its toggle already in the first commit", async () => {
    await writesAfterMount(tall(7));
    const host = document.createElement("div");
    host.style.width = "360px";
    document.body.append(host);
    mounted.push(host);
    const root = createRoot(host);
    roots.push(root);
    flushSync(() => root.render(tall(7)));
    expect(host.querySelector("[data-ouro-show-more-toggle]")).not.toBeNull();
    expect(host.querySelector("[data-ouro-show-more-fold]")!.hasAttribute("data-folded")).toBe(true);
  });

  it("measures every mount when it has no measureKey, and a different key measures again", async () => {
    const body = <div style={{ height: 300 }} />;
    await writesAfterMount(<ShowMore maxHeight={120}>{body}</ShowMore>);
    expect((await writesAfterMount(<ShowMore maxHeight={120}>{body}</ShowMore>)).writes).toBeGreaterThan(0);
    await writesAfterMount(<ShowMore lines={2}>{longText}</ShowMore>);
    expect((await writesAfterMount(<ShowMore lines={2}>{longText}</ShowMore>)).writes).toBeGreaterThan(0);
    const other = await writesAfterMount(<ShowMore maxHeight={120} measureKey="never-seen">{body}</ShowMore>);
    expect(other.writes).toBeGreaterThan(0);
  });

  it("corrects a remembered answer that is wrong now, with the new width", async () => {
    const node = (width: number) => (
      <div style={{ width }}>
        <ShowMore lines={2} measureKey="resized">{longText}</ShowMore>
      </div>
    );
    const wide = await writesAfterMount(node(2000));
    expect(wide.buttons).toBe(0);
    const narrow = await writesAfterMount(node(120));
    expect(narrow.buttons).toBe(1);
  });

  it("forgets the oldest answers once a thousand more have been measured, and keeps the newest", async () => {
    await writesAfterMount(clamped(900));
    const many = document.createElement("div");
    document.body.append(many);
    mounted.push(many);
    const root = createRoot(many);
    roots.push(root);
    flushSync(() => root.render(<>{Array.from({ length: 1000 }, (_, index) => <ShowMore key={index} lines={2} measureKey={`bulk-${index}`}>{`${index}: ${longText}`}</ShowMore>)}</>));
    await expect.poll(() => many.querySelectorAll("[data-ouro-show-more-toggle]").length).toBe(1000);
    expect((await writesAfterMount(clamped(900))).writes).toBeGreaterThan(0);
    const newest = document.createElement("div");
    newest.style.width = "360px";
    document.body.append(newest);
    mounted.push(newest);
    const again = createRoot(newest);
    roots.push(again);
    flushSync(() => again.render(<ShowMore lines={2} measureKey="bulk-999">{`999: ${longText}`}</ShowMore>));
    expect(newest.querySelector("[data-ouro-show-more-toggle]")).not.toBeNull();
  });
});
