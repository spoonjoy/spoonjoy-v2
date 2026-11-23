import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { commands, server, userEvent } from "vitest/browser";
import { Button } from "~/components/ouro/button/button";
import { Dialog } from "~/components/ouro/dialog/dialog";
import { Sheet } from "~/components/ouro/sheet/sheet";
import { Card } from "~/components/ouro/card/card";
import { Popover } from "~/components/ouro/popover/popover";
import { ScrollArea } from "~/components/ouro/scroll-area/scroll-area";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
let mounted: Element[] = [];

afterEach(async () => {
  for (const name of Object.keys(distinct)) document.documentElement.style.removeProperty(name);
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

// A theme sets its fills on the root, where portals read them too.
async function render(node: ReactNode, style: Record<string, string> = {}) {
  const host = document.createElement("div");
  for (const [name, value] of Object.entries(style)) document.documentElement.style.setProperty(name, value);
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return host;
}

/** A theme variable as the browser computes it under `host`, so the tests hold under any app theme. */
function fill(variable: string): string {
  const probe = document.createElement("div");
  probe.style.backgroundColor = `var(${variable})`;
  document.body.append(probe);
  const value = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return value;
}

const viewportOf = (scope: ParentNode) => scope.querySelector<HTMLElement>("[data-scroll-viewport]")!;
const background = (element: Element) => getComputedStyle(element).backgroundColor;

// Three fills no theme shares, as a third-party theme that gives each surface its own would.
const distinct = { "--background": "rgb(250, 250, 240)", "--card": "rgb(240, 250, 250)", "--popover": "rgb(250, 240, 250)" };

describe("ScrollArea surface", () => {
  it.each([
    ["the theme's own fills", {}],
    ["a theme whose page, card and popover fills differ", distinct],
  ])("paints its viewport with the page's background, opaque, on the page (%s)", async (_name, style) => {
    const host = await render(<ScrollArea label="Steps">x</ScrollArea>, style);
    const viewport = viewportOf(host);
    expect(background(viewport)).toBe(fill("--background"));
    expect(background(viewport)).not.toMatch(/rgba|transparent/);
  });

  it.each([
    ["the theme's own fills", {}],
    ["a theme whose page, card and popover fills differ", distinct],
  ])("paints its viewport with the Card's fill inside a Card (%s)", async (_name, style) => {
    const host = await render(
      <Card title="Method">
        <ScrollArea label="Steps">x</ScrollArea>
      </Card>,
      style,
    );
    expect(background(viewportOf(host))).toBe(fill("--card"));
  });

  it.each([
    ["the theme's own fills", {}],
    ["a theme whose page, card and popover fills differ", distinct],
  ])("paints its viewport with the Popover's fill inside a Popover (%s)", async (_name, style) => {
    const host = await render(
      <Popover title="Share" trigger={<Button>Share</Button>}>
        <ScrollArea label="Steps">x</ScrollArea>
      </Popover>,
      style,
    );
    await userEvent.click(host.querySelector("button")!);
    await expect.poll(() => document.querySelector('[role="dialog"] [data-scroll-viewport]')).not.toBeNull();
    expect(background(document.querySelector('[role="dialog"] [data-scroll-viewport]')!)).toBe(fill("--popover"));
  });

  it.each([
    ["Dialog", (children: ReactNode) => <Dialog title="Share" trigger={<Button>Share</Button>}>{children}</Dialog>],
    ["Sheet", (children: ReactNode) => <Sheet title="Share" trigger={<Button>Share</Button>}>{children}</Sheet>],
  ])("paints its viewport with the popover fill inside a %s", async (_name, surface) => {
    const host = await render(surface(<ScrollArea label="Steps">x</ScrollArea>), distinct);
    await userEvent.click(host.querySelector("button")!);
    await expect.poll(() => document.querySelector('[role="dialog"] [data-scroll-viewport]')).not.toBeNull();
    expect(background(document.querySelector('[role="dialog"] [data-scroll-viewport]')!)).toBe(fill("--popover"));
  });

  it("follows the token an app sets on the surface behind it", async () => {
    const host = await render(
      <div style={{ "--ouro-scroller-surface": "rgb(1, 2, 3)" } as React.CSSProperties}>
        <ScrollArea label="Steps">x</ScrollArea>
      </div>,
    );
    expect(background(viewportOf(host))).toBe("rgb(1, 2, 3)");
  });

  it("stays see-through inside a glass surface that opts out, so the glass shows", async () => {
    const host = await render(
      <div style={{ "--ouro-scroller-surface": "transparent" } as React.CSSProperties}>
        <ScrollArea label="Steps">x</ScrollArea>
      </div>,
    );
    expect(background(viewportOf(host))).toBe("rgba(0, 0, 0, 0)");
  });

  // Chromium on Windows promotes a scroller to the compositor only when it is opaque or the display scales
  // 150% or more (ourostack/ouro-ui#2891); an opaque viewport is promoted everywhere, so this holds on every host.
  it.skipIf(server.browser !== "chromium")("is a layer of its own that the compositor scrolls, the page's background behind it", async () => {
    const host = await render(
      <ScrollArea label="Steps" className="h-48">
        <div style={{ height: 1200 }}>x</div>
      </ScrollArea>,
    );
    const viewport = viewportOf(host);
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
    const layers = await commands.compositedLayers();
    expect(layers.some((layer) => layer.element?.endsWith('[data-ouro-part="viewport"]'))).toBe(true);
  });
});
