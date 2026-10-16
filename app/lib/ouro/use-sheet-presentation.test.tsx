import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { pickerSheetQuery, usePickerSheet, useSheetPresentation } from "~/lib/ouro/use-sheet-presentation";
import { act } from "~/lib/ouro/testing/act";

function Probe({ presentation }: { presentation: string }) {
  return <span>{String(useSheetPresentation(presentation))}</span>;
}

function PickerProbe() {
  return <span>{String(usePickerSheet())}</span>;
}

let root: Root | undefined;

async function shown(node: React.ReactNode): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(node));
  return container;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  await page.viewport(1000, 800);
});

describe("useSheetPresentation", () => {
  it("is always a sheet for \"sheet\" and never for \"dialog\", at any width", async () => {
    await page.viewport(1000, 800);
    expect((await shown(<Probe presentation="sheet" />)).textContent).toBe("true");
    await act(async () => root!.unmount());
    await page.viewport(400, 800);
    expect((await shown(<Probe presentation="dialog" />)).textContent).toBe("false");
  });

  it("follows the 640px breakpoint for \"auto\"", async () => {
    await page.viewport(1000, 800);
    const container = await shown(<Probe presentation="auto" />);
    expect(container.textContent).toBe("false");
    await page.viewport(400, 800);
    await vi.waitFor(() => expect(container.textContent).toBe("true"));
  });

  it("renders the wide form on the server", () => {
    expect(renderToString(<Probe presentation="auto" />)).toContain("false");
    expect(renderToString(<Probe presentation="sheet" />)).toContain("true");
  });
});

describe("usePickerSheet", () => {
  it("asks for a narrow screen with a coarse pointer", () => {
    expect(pickerSheetQuery).toBe("(max-width: 639px) and (pointer: coarse)");
  });

  it("is a sheet only while that query matches, and a popup on the server", async () => {
    expect(renderToString(<PickerProbe />)).toContain("false");
    const matches = (query: string, value: boolean) =>
      vi.stubGlobal("matchMedia", (asked: string) => ({
        matches: asked === query ? value : false,
        media: asked,
        addEventListener: () => {},
        removeEventListener: () => {},
      }));
    matches(pickerSheetQuery, true);
    expect((await shown(<PickerProbe />)).textContent).toBe("true");
    await act(async () => root!.unmount());
    matches(pickerSheetQuery, false);
    expect((await shown(<PickerProbe />)).textContent).toBe("false");
  });
});
