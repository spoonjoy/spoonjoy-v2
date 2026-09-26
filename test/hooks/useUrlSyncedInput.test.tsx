import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useLoaderData } from "react-router";
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
