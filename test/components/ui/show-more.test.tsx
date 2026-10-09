import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useLoaderData } from "react-router";
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
});
