import { Popover } from "@base-ui/react/popover";
import { createRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { OuroProvider } from "~/lib/ouro/ouro-provider";
import { PortalScope, usePortalContainer } from "~/lib/ouro/portal-container";
import { act } from "~/lib/ouro/testing/act";

// A floating layer as Ouro UI's own are built: its Portal takes usePortalContainer's props,
// and what renders inside it sits in a PortalScope. devWarn prints each message once per
// module, so a test that expects no warning names its own component.
function Layer({ name, component = "Layer", children }: { name: string; component?: string; children?: ReactNode }) {
  const portal = usePortalContainer(component);
  return (
    <Popover.Root defaultOpen>
      <Popover.Trigger>{`Open ${name}`}</Popover.Trigger>
      <Popover.Portal {...portal} data-layer={name}>
        <PortalScope>
          <Popover.Positioner>
            <Popover.Popup aria-label={name}>
              {name}
              {children}
            </Popover.Popup>
          </Popover.Positioner>
        </PortalScope>
      </Popover.Portal>
    </Popover.Root>
  );
}

const roots: Root[] = [];
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  warn.mockRestore();
});

/** Renders `node` into a fresh element appended to `parent`. */
async function render(node: ReactNode, parent: Element = document.body) {
  const host = parent.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return host;
}

/** A page with a main landmark, and the element inside it popups render into. */
function page() {
  const main = document.body.appendChild(document.createElement("main"));
  const popups = main.appendChild(document.createElement("div"));
  return { main, popups };
}

const portalOf = (name: string) => document.querySelector(`[data-layer="${name}"]`)!;

describe("usePortalContainer", () => {
  it("leaves a popup at the end of <body>, Base UI's default, without a portalContainer", async () => {
    await render(<Layer name="Tags" />);
    expect(portalOf("Tags").parentElement).toBe(document.body);
  });

  it("renders a popup into OuroProvider's portalContainer, given as an element", async () => {
    const { popups } = page();
    await render(
      <OuroProvider portalContainer={popups}>
        <Layer name="Tags" />
      </OuroProvider>,
    );
    expect(portalOf("Tags").parentElement).toBe(popups);
  });

  it("renders a popup into OuroProvider's portalContainer, given as a ref", async () => {
    const { popups } = page();
    const ref = createRef<HTMLElement>();
    ref.current = popups;
    await render(
      <OuroProvider portalContainer={ref}>
        <Layer name="Tags" />
      </OuroProvider>,
    );
    expect(portalOf("Tags").parentElement).toBe(popups);
  });

  it("renders a popup open on the first render into a portalContainer ref whose element comes later in the page", async () => {
    const ref = createRef<HTMLDivElement>();
    await render(
      <OuroProvider portalContainer={ref}>
        <Layer name="Tags" component="Late" />
        <main>
          <div ref={ref} data-popups="" />
        </main>
      </OuroProvider>,
    );
    await expect.poll(() => portalOf("Tags").parentElement).toBe(document.querySelector("[data-popups]"));
  });

  it("gives popups Base UI's own place again inside an OuroProvider whose portalContainer is null, as an app's own dialog needs", async () => {
    const popups = document.body.appendChild(document.createElement("div"));
    await render(
      <OuroProvider portalContainer={popups}>
        <OuroProvider portalContainer={null}>
          <Layer name="Tags" component="Own" />
        </OuroProvider>
      </OuroProvider>,
    );
    expect(portalOf("Tags").parentElement).toBe(document.body);
  });

  it("renders on the server, where a portal renders nothing and a ref holds no element yet", () => {
    const ref = createRef<HTMLDivElement>();
    const html = renderToString(
      <OuroProvider portalContainer={ref}>
        <Layer name="Tags" component="Served" />
      </OuroProvider>,
    );
    expect(html).toContain("Open Tags");
    expect(html).not.toContain('data-layer="Tags"');
  });

  it("keeps the portalContainer of an outer OuroProvider inside one that does not set it", async () => {
    const { popups } = page();
    await render(
      <OuroProvider portalContainer={popups}>
        <OuroProvider>
          <Layer name="Tags" />
        </OuroProvider>
      </OuroProvider>,
    );
    expect(portalOf("Tags").parentElement).toBe(popups);
  });

  it("renders a popup opened from inside another popup into that popup's portal, not the portalContainer", async () => {
    const { popups } = page();
    await render(
      <OuroProvider portalContainer={popups}>
        <Layer name="Outer">
          <Layer name="Inner" />
        </Layer>
      </OuroProvider>,
    );
    expect(portalOf("Outer").parentElement).toBe(popups);
    expect(portalOf("Inner").parentElement).toBe(portalOf("Outer"));
  });

  it("warns once, in development, when a popup opens outside every landmark of a page that has a main", async () => {
    page();
    await render(
      <>
        <Layer name="Tags" />
        <Layer name="Sort" />
      </>,
    );
    expect(warn.mock.calls).toEqual([
      [
        "[ouro-ui] Layer: the open popup renders outside every landmark, so screen reader users who move by landmark miss it. Fix: <OuroProvider portalContainer={popups}> around the app, with <div ref={popups} /> inside <main>.",
      ],
    ]);
  });

  it("warns for a popup in a section's header, which is no landmark, on a page whose main is a role", async () => {
    const main = document.body.appendChild(document.createElement("div"));
    main.setAttribute("role", "main");
    const header = document.body.appendChild(document.createElement("section")).appendChild(document.createElement("header"));
    await render(
      <OuroProvider portalContainer={header}>
        <Layer name="Tags" component="Header" />
      </OuroProvider>,
    );
    expect(warn.mock.calls.map((call) => call[0])).toEqual([expect.stringMatching(/^\[ouro-ui\] Header: the open popup renders outside every landmark/)]);
  });

  it("does not warn on a page without a main, or for a popup inside a landmark", async () => {
    await render(<Layer name="Tags" component="Quiet" />);
    const { popups } = page();
    await render(
      <OuroProvider portalContainer={popups}>
        <Layer name="Sort" component="Quiet" />
      </OuroProvider>,
    );
    const nav = document.body.appendChild(document.createElement("nav"));
    await render(
      <OuroProvider portalContainer={nav}>
        <Layer name="Filter" component="Quiet" />
      </OuroProvider>,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn for a popup inside a dialog or another popup", async () => {
    page();
    const dialog = document.body.appendChild(document.createElement("div"));
    dialog.setAttribute("role", "dialog");
    await render(
      <OuroProvider portalContainer={dialog}>
        <Layer name="Outer" component="Calm">
          <Layer name="Inner" component="Calm" />
        </Layer>
      </OuroProvider>,
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
