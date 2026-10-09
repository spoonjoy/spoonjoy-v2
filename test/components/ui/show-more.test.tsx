import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, useLoaderData, useNavigate } from "react-router";
import { createTestRoutesStub } from "../../utils";
import { ShowMore, useAppendingList, type AppendingList } from "~/components/ui/show-more";

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
      <ul>{list.items.map((row) => <li key={row.id}>{row.name}</li>)}</ul>
      <p data-testid="first-new">{String(list.firstNewIndex)}</p>
      <ShowMore list={list} href={list.nextCursor ? `/rows?after=${list.nextCursor}` : null} label="Show more rows" />
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
  // Saved rows are keyed by history entry, and every memory router starts on the "default" entry.
  beforeEach(() => window.sessionStorage.clear());

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
    expect(screen.getByTestId("show-more-status")).toHaveTextContent("Showing 3 rows");

    fireEvent.click(screen.getByRole("link", { name: "Show more rows" }));
    await waitFor(() => expect(latest!.nextCursor).toBeNull());
    expect(latest!.loading).toBe(false);
    expect(screen.queryByRole("link", { name: "Show more rows" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Corn")).toHaveLength(1);
    expect(screen.getByTestId("first-new")).toHaveTextContent("2");
    expect(screen.getByTestId("show-more-status")).toHaveTextContent("Showing 3 rows");

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
    const busy = await screen.findByRole("link", { name: "Loading…" });
    expect(busy).toHaveAttribute("aria-busy", "true");
    release();
    expect(await screen.findByText("Zucchini")).toBeInTheDocument();
  });
  it("leaves no spacing where the button was once there is no next page", () => {
    const list = { nextCursor: null, loading: false, showMore: () => {}, announcement: "Showing 60 recipes" };
    const { container, rerender } = render(<ShowMore list={{ ...list, nextCursor: "c" }} href="/rows?after=c" label="Show more" />, { wrapper: MemoryRouter });
    // With a next page, the button keeps its space under the list.
    expect(container.firstElementChild).toHaveClass("mt-6");
    rerender(<ShowMore list={list} href={null} label="Show more" />);
    expect(screen.queryByTestId("show-more")).toBeNull();
    // The status still announces the last page, but the wrapper adds no margin of its own.
    expect(screen.getByTestId("show-more-status")).toHaveTextContent("Showing 60 recipes");
    expect(container.firstElementChild).not.toHaveClass("mt-6");
  });
  it("restores appended rows when the visitor goes back to the list, and only then", async () => {
    const loads: string[] = [];
    const pages: Record<string, Data> = {
      first: { rows: [{ id: "a", name: "Apple" }], next: "a", key: "k" },
      a: { rows: [{ id: "b", name: "Bean" }], next: "b", key: "k" },
    };
    function Away() {
      const navigate = useNavigate();
      return (
        <>
          <button type="button" onClick={() => navigate(-1)}>Back</button>
          <Link to="/rows">Rows again</Link>
        </>
      );
    }
    function RowsWithLink() {
      return (
        <>
          <Rows />
          <Link to="/away">Open a row</Link>
        </>
      );
    }
    const Stub = createTestRoutesStub([
      {
        path: "/rows",
        children: [
          {
            index: true,
            Component: RowsWithLink,
            loader: ({ request }: { request: Request }) => {
              const after = new URL(request.url).searchParams.get("after") ?? "first";
              loads.push(after);
              return pages[after]!;
            },
          },
        ],
      },
      { path: "/away", Component: Away },
    ]);
    render(<Stub initialEntries={["/rows"]} />);

    fireEvent.click(await screen.findByRole("link", { name: "Show more rows" }));
    expect(await screen.findByText("Bean")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Open a row" }));
    fireEvent.click(await screen.findByRole("button", { name: "Back" }));

    // Back on the same history entry: the appended row is there with the first page, without
    // fetching its page again, and Show more continues from where it was.
    expect(await screen.findByText("Bean")).toBeInTheDocument();
    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(loads.filter((after) => after === "a")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Show more rows" })).toHaveAttribute("href", "/rows?after=b");
    expect(screen.getByTestId("first-new")).toHaveTextContent("null");

    // A new visit to the list is a new history entry, so it starts from the first page.
    fireEvent.click(screen.getByRole("link", { name: "Open a row" }));
    fireEvent.click(await screen.findByRole("link", { name: "Rows again" }));
    expect(await screen.findByText("Apple")).toBeInTheDocument();
    expect(screen.queryByText("Bean")).not.toBeInTheDocument();
  });

  it("starts from the first page when saved rows are unreadable", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    try {
      const Stub = stub({ first: { rows: [{ id: "a", name: "Apple" }], next: "a", key: "k" } });
      render(<Stub initialEntries={["/rows"]} />);
      expect(await screen.findByText("Apple")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Show more rows" })).toHaveAttribute("href", "/rows?after=a");
    } finally {
      getItem.mockRestore();
    }
  });
});
