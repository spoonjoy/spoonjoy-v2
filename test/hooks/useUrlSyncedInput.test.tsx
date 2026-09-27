import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { describe, expect, it } from "vitest";
import { useLoaderData, useNavigate } from "react-router";
import { useUrlSyncedInput } from "~/hooks/useUrlSyncedInput";
import { createTestRoutesStub } from "../utils";

function SearchBox() {
  const { query } = useLoaderData<{ query: string }>();
  const inputRef = useUrlSyncedInput(query);
  return <input ref={inputRef} aria-label="Search box" defaultValue={query} />;
}

function renderSearchBox(url: string) {
  const Stub = createTestRoutesStub([
    {
      path: "/search",
      Component: SearchBox,
      loader: ({ request }: { request: Request }) => ({ query: new URL(request.url).searchParams.get("q") ?? "" }),
    },
  ]);
  return render(<Stub initialEntries={[url]} />);
}

function firePageShow(persisted: boolean) {
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: persisted });
  window.dispatchEvent(event);
}

describe("useUrlSyncedInput", () => {
  it("updates the box in the same commit as the new results, before the browser paints", async () => {
    // What the box holds at the moment each navigation's results reach the page. A passive effect
    // would set the box only after this commit, leaving a painted frame where the box and the
    // results disagree.
    const seenAtCommit: string[] = [];
    function CommitProbe() {
      const { query } = useLoaderData<{ query: string }>();
      useLayoutEffect(() => {
        const box = document.querySelector<HTMLInputElement>('input[aria-label="Search box"]')!;
        seenAtCommit.push(`${query} -> ${box.value}`);
      }, [query]);
      return null;
    }
    function SearchBoxThenProbe() {
      const navigate = useNavigate();
      return (
        <>
          <button type="button" onClick={() => navigate("/search?q=saffron")}>Search saffron</button>
          <SearchBox />
          <CommitProbe />
        </>
      );
    }
    const Stub = createTestRoutesStub([
      {
        path: "/search",
        Component: SearchBoxThenProbe,
        loader: ({ request }: { request: Request }) => ({ query: new URL(request.url).searchParams.get("q") ?? "" }),
      },
    ]);
    render(<Stub initialEntries={["/search?q=lemon"]} />);
    const box = (await screen.findByLabelText("Search box")) as HTMLInputElement;
    fireEvent.change(box, { target: { value: "half typed" } });

    fireEvent.click(screen.getByRole("button", { name: "Search saffron" }));
    await waitFor(() => expect(box.value).toBe("saffron"));

    expect(seenAtCommit).toEqual(["lemon -> lemon", "saffron -> saffron"]);
  });

  it("resets stale typed text to the URL query when the page is restored from the back/forward cache", async () => {
    const { unmount } = renderSearchBox("/search?q=lemon");
    const box = (await screen.findByLabelText("Search box")) as HTMLInputElement;
    expect(box.value).toBe("lemon");

    fireEvent.change(box, { target: { value: "saffron" } });
    firePageShow(true);
    expect(box.value).toBe("lemon");

    unmount();
    // After unmount the listener is gone, so a later restore does not touch the old input.
    fireEvent.change(box, { target: { value: "detached" } });
    firePageShow(true);
    expect(box.value).toBe("detached");
  });

  it("leaves typed text alone on an ordinary (not cached) page show", async () => {
    renderSearchBox("/search?q=lemon");
    const box = (await screen.findByLabelText("Search box")) as HTMLInputElement;

    fireEvent.change(box, { target: { value: "half typed" } });
    firePageShow(false);
    expect(box.value).toBe("half typed");
  });
});
