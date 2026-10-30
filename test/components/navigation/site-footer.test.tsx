import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteFooter } from "~/components/navigation/site-footer";
import { XrayProvider, useXray } from "~/components/xray/xray-provider";
import { Button } from "~/components/ouro/button/button";
import manifest from "~/generated/ouro-provenance.json";

const SHA = "0123456789abcdef0123456789abcdef01234567";

/** happy-dom lays nothing out, so X-ray would find every component zero-sized; give HX roots a box. */
function layOutComponents() {
  const original = Element.prototype.getBoundingClientRect;
  return vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return this.hasAttribute("data-ouro") ? new DOMRect(0, 0, 120, 24) : original.call(this);
  });
}

/** A root layout with X-ray and the footer around one page, as app/root.tsx renders them. */
function renderSite(path = "/recipes", page = <Button href="/recipes/new">New recipe</Button>) {
  const router = createMemoryRouter(
    [
      {
        id: "root",
        path: "/",
        element: (
          <XrayProvider sourceSha={SHA}>
            <main>
              <Outlet />
            </main>
            <SiteFooter />
          </XrayProvider>
        ),
        children: [
          { id: "routes/recipes", path: "recipes", element: <Outlet />, children: [{ id: "routes/recipes._index", index: true, element: page }] },
          { id: "routes/test-kitchen", path: "test-kitchen", element: page },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

describe("SiteFooter", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(manifest));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("credits Ouro HX with a link to its site, outside the page's main content", () => {
    renderSite();
    const footer = screen.getByRole("contentinfo");
    const credit = within(footer).getByRole("link", { name: "Built with Ouro HX" });
    expect(credit).toHaveAttribute("href", "https://ui.ouro.bot/");
    expect(within(footer).getByRole("button", { name: "See all the components" })).toBeInTheDocument();
    expect(footer.closest("main")).toBeNull();
    // It stays off the page until asked: no X-ray and no request for the manifest.
    expect(screen.queryByRole("region", { name: "X-ray" })).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("turns X-ray on from \"See all the components\", listing the page's components with their docs and source", async () => {
    layOutComponents();
    const user = userEvent.setup();
    renderSite();

    await user.click(screen.getByRole("button", { name: "See all the components" }));
    const bar = await screen.findByRole("region", { name: "X-ray" });
    expect(fetchSpy).toHaveBeenCalledWith("/ouro-provenance.json");

    await user.click(bar.querySelector<HTMLElement>('[data-ouro-part="list"]')!);
    const list = await screen.findByRole("dialog", { name: "X-ray" });
    expect(within(list).getAllByRole("link", { name: /^Docs for button/ })[0]).toHaveAttribute("href", "https://ui.ouro.bot/docs/button/");
    // Source links name the page's route module at the running commit, once the manifest is in.
    const recipes = manifest.routes.find((route) => route.file === "app/routes/recipes._index.tsx")!;
    const expected = recipes.renders["button"]?.length === 1 ? recipes.renders["button"]![0] : "app/routes/recipes._index.tsx";
    await waitFor(() =>
      expect(within(list).getAllByRole("link", { name: "Source of button (opens in a new tab)" })[0]).toHaveAttribute(
        "href",
        `https://github.com/spoonjoy/spoonjoy-v2/blob/${SHA}/${expected}`,
      ),
    );
  });

  it("opens X-ray on arrival with ?xray, on any page", async () => {
    renderSite("/recipes?xray");
    expect(await screen.findByRole("region", { name: "X-ray" })).toBeInTheDocument();
  });

  it("shares one X-ray with a page's own switch", async () => {
    function PageSwitch() {
      const { open, setOpen } = useXray();
      return <button type="button" aria-pressed={open} onClick={() => setOpen(!open)}>Page X-ray</button>;
    }
    const user = userEvent.setup();
    renderSite("/test-kitchen", <PageSwitch />);

    await user.click(screen.getByRole("button", { name: "See all the components" }));
    expect(await screen.findByRole("region", { name: "X-ray" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Page X-ray" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("region", { name: "X-ray" })).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Page X-ray" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "X-ray" })).not.toBeInTheDocument());
  });

  it("keeps X-ray working without Source links when the manifest cannot be read", async () => {
    fetchSpy.mockImplementation(async () => new Response("nope", { status: 500 }));
    layOutComponents();
    const user = userEvent.setup();
    renderSite();

    await user.click(screen.getByRole("button", { name: "See all the components" }));
    const bar = await screen.findByRole("region", { name: "X-ray" });
    await user.click(bar.querySelector<HTMLElement>('[data-ouro-part="list"]')!);
    const list = await screen.findByRole("dialog", { name: "X-ray" });
    expect(within(list).getAllByRole("link", { name: /^Docs for button/ }).length).toBeGreaterThan(0);
    expect(within(list).queryByRole("link", { name: /^Source of/ })).not.toBeInTheDocument();
  });

  it("links a page the manifest does not list to the root layout's files", async () => {
    fetchSpy.mockImplementation(async () => Response.json({ root: { file: "app/root.tsx", renders: { button: ["app/components/navigation/site-footer.tsx"] } }, routes: [] }));
    layOutComponents();
    const user = userEvent.setup();
    renderSite();

    await user.click(screen.getByRole("button", { name: "See all the components" }));
    const bar = await screen.findByRole("region", { name: "X-ray" });
    await user.click(bar.querySelector<HTMLElement>('[data-ouro-part="list"]')!);
    const list = await screen.findByRole("dialog", { name: "X-ray" });
    await waitFor(() =>
      expect(within(list).getAllByRole("link", { name: "Source of button (opens in a new tab)" })[0]).toHaveAttribute(
        "href",
        `https://github.com/spoonjoy/spoonjoy-v2/blob/${SHA}/app/components/navigation/site-footer.tsx`,
      ),
    );
    expect(within(list).getAllByRole("link", { name: "Source of link (opens in a new tab)" })[0]).toHaveAttribute(
      "href",
      `https://github.com/spoonjoy/spoonjoy-v2/blob/${SHA}/app/root.tsx`,
    );
  });

  it("shows no Source links when the manifest request fails outright", async () => {
    fetchSpy.mockImplementation(async () => {
      throw new TypeError("offline");
    });
    layOutComponents();
    const user = userEvent.setup();
    renderSite();

    await user.click(screen.getByRole("button", { name: "See all the components" }));
    const bar = await screen.findByRole("region", { name: "X-ray" });
    await user.click(bar.querySelector<HTMLElement>('[data-ouro-part="list"]')!);
    const list = await screen.findByRole("dialog", { name: "X-ray" });
    expect(within(list).getAllByRole("link", { name: /^Docs for button/ }).length).toBeGreaterThan(0);
    expect(within(list).queryByRole("link", { name: /^Source of/ })).not.toBeInTheDocument();
  });

  it("throws a clear error when X-ray is used outside its provider", () => {
    function Orphan() {
      useXray();
      return null;
    }
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Orphan />)).toThrow("useXray needs <XrayProvider>");
  });
});
