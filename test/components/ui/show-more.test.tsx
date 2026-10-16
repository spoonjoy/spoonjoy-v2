import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useLoaderData } from "react-router";
import { createTestRoutesStub } from "../../utils";
import { ShowMore } from "~/components/ouro/collapsible/show-more";
import { useAppendingList, type AppendingList } from "~/hooks/use-appending-list";

type Row = { id: string; name: string };
type Data = { rows: Row[]; next: string | null; key: string };

const select = (data: Data) => ({ items: data.rows, nextCursor: data.next });
const loadHref = (cursor: string) => `/rows?index&after=${cursor}`;
let latest: AppendingList<Row> | null = null;

function Rows() {
  const data = useLoaderData() as Data;
  const list = useAppendingList({ page: { items: data.rows, nextCursor: data.next }, resetKey: data.key, loadHref, select, noun: "rows" });
  latest = list;
  return (
    <>
      <p data-testid="first-new">{String(list.firstNewIndex)}</p>
      <ShowMore
        items={list.items.map((row) => <a key={row.id} href={`/row/${row.id}`}>{row.name}</a>)}
        hasMore={Boolean(list.nextCursor)}
        loading={list.loading}
        onShowMore={list.showMore}
        href={list.nextCursor ? `/rows?after=${list.nextCursor}` : undefined}
        showMoreLabel="Show more rows"
        loadedLabel={(count) => `Showing ${count} rows`}
        noMoreLabel={`Showing ${list.items.length} rows`}
      />
    </>
  );
}

function stub(pages: Record<string, Data>) {
  return createTestRoutesStub([
    {
      path: "/rows",
      children: [
        {
          index: true,
          Component: Rows,
          loader: ({ request }: { request: Request }) => pages[new URL(request.url).searchParams.get("after") ?? "first"]!,
        },
      ],
    },
  ]);
}

describe("useAppendingList and ShowMore", () => {
  it("starts one real Router load when two native activations arrive before the loading render", async () => {
    let requests = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const Stub = createTestRoutesStub([{
      path: "/rows", Component: Rows,
      loader: async ({ request }: { request: Request }) => {
        if (new URL(request.url).searchParams.has("after")) {
          requests++;
          await held;
          return { rows: [{ id: "b", name: "Bean" }], next: null, key: "k" };
        }
        return { rows: [{ id: "a", name: "Apple" }], next: "a", key: "k" };
      },
    }]);
    render(<Stub initialEntries={["/rows"]} />);
    const trigger = await screen.findByRole("link", { name: "Show more rows" });
    try {
      // One native event batch: React has not committed Router's deferred busy render.
      act(() => { fireEvent.click(trigger); fireEvent.click(trigger); });
      await waitFor(() => expect(requests).toBe(1));
    } finally {
      await act(async () => release());
    }
    expect(await screen.findByText("Bean")).toHaveFocus();
  });

  it("does not ask twice while a real Router page request is held", async () => {
    let requests = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const Stub = createTestRoutesStub([{
      path: "/rows",
      Component: Rows,
      loader: async ({ request }: { request: Request }) => {
        if (new URL(request.url).searchParams.has("after")) {
          requests += 1;
          await gate;
          return { rows: [{ id: "b", name: "Bean" }], next: null, key: "k" };
        }
        return { rows: [{ id: "a", name: "Apple" }], next: "a", key: "k" };
      },
    }]);
    render(<Stub initialEntries={["/rows"]} />);
    fireEvent.click(await screen.findByRole("link", { name: "Show more rows" }));
    const busy = await screen.findByRole("link", { name: "Show more rows" });
    await waitFor(() => expect(busy).toHaveAttribute("aria-busy", "true"));
    fireEvent.click(busy);
    await waitFor(() => expect(requests).toBe(1));
    release();
    expect(await screen.findByText("Bean")).toBeInTheDocument();
  });
  it("drops rows it already shows and keeps the last focus target when a page adds nothing new", async () => {
    const Stub = stub({
      first: { rows: [{ id: "a", name: "Apple" }, { id: "b", name: "Bean" }], next: "b", key: "k" },
      // The second page repeats "b" (it changed while the visitor read) and adds "c".
      b: { rows: [{ id: "b", name: "Bean" }, { id: "c", name: "Corn" }], next: "c", key: "k" },
      // The third adds nothing new but still says there is no more.
      c: { rows: [{ id: "c", name: "Corn" }], next: null, key: "k" },
    });
    render(<Stub initialEntries={["/rows"]} />);

    fireEvent.click(await screen.findByRole("link", { name: "Show more rows" }));
    expect(await screen.findByText("Corn")).toBeInTheDocument();
    expect(screen.getAllByText("Bean")).toHaveLength(1);
    expect(screen.getByTestId("first-new")).toHaveTextContent("2");
    await waitFor(() => expect(document.querySelector("[data-ouro-show-more-status]")).toHaveTextContent("Showing 3 rows"));
    expect(screen.getByRole("link", { name: "Corn" })).toHaveFocus();

    fireEvent.click(screen.getByRole("link", { name: "Show more rows" }));
    await waitFor(() => expect(latest!.nextCursor).toBeNull());
    expect(latest!.loading).toBe(false);
    expect(screen.queryByRole("link", { name: "Show more rows" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Corn")).toHaveLength(1);
    expect(screen.getByTestId("first-new")).toHaveTextContent("2");
    await waitFor(() => expect(document.querySelector("[data-ouro-show-more-status]")).toHaveTextContent("Showing 3 rows"));
    expect(screen.getByRole("link", { name: "Corn" })).toHaveFocus();

    // With no next page, asking for more does nothing.
    act(() => latest!.showMore());
    expect(latest!.loading).toBe(false);
  });

  it("shows a busy label while the next page loads", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const Stub = createTestRoutesStub([
      {
        path: "/rows",
        children: [
          {
            index: true,
            Component: Rows,
            loader: async ({ request }: { request: Request }) => {
              if (new URL(request.url).searchParams.get("after")) {
                await gate;
                return { rows: [{ id: "z", name: "Zucchini" }], next: null, key: "k" };
              }
              return { rows: [{ id: "a", name: "Apple" }], next: "a", key: "k" };
            },
          },
        ],
      },
    ]);
    render(<Stub initialEntries={["/rows"]} />);

    fireEvent.click(await screen.findByRole("link", { name: "Show more rows" }));
    const busy = await screen.findByRole("link", { name: "Show more rows" });
    await waitFor(() => expect(busy).toHaveAttribute("aria-busy", "true"));
    release();
    expect(await screen.findByText("Zucchini")).toBeInTheDocument();
  });
});
