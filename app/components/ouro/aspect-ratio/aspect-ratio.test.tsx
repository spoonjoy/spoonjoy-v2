import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AspectRatio } from "~/components/ouro/aspect-ratio/aspect-ratio";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.width = "320px";
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return { host, el: host.firstElementChild as HTMLElement };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

// A 1x1 transparent GIF, so no request leaves the test.
const pixel = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

describe("AspectRatio", () => {
  it("renders a full-width frame of the given ratio with data-ouro", async () => {
    const { el } = await render(
      <AspectRatio ratio={16 / 9}>
        <img src={pixel} alt="Short ribs" />
      </AspectRatio>,
    );
    expect(el.getAttribute("data-ouro")).toBe("aspect-ratio");
    const rect = el.getBoundingClientRect();
    expect(rect.width).toBe(320);
    expect(rect.height).toBe(180);
  });

  it("fills the frame with its media, cropped to cover", async () => {
    const { el } = await render(
      <AspectRatio ratio={4 / 3}>
        <img src={pixel} alt="Short ribs" />
      </AspectRatio>,
    );
    const img = el.querySelector("img")!;
    const rect = img.getBoundingClientRect();
    expect(rect.width).toBe(320);
    expect(rect.height).toBe(240);
    expect(getComputedStyle(img).objectFit).toBe("cover");
  });

  it("letterboxes with fit=contain", async () => {
    const { el } = await render(
      <AspectRatio ratio={1} fit="contain">
        <video aria-label="Searing" />
      </AspectRatio>,
    );
    expect(getComputedStyle(el.querySelector("video")!).objectFit).toBe("contain");
  });

  it("clips its content and keeps any other child at full size", async () => {
    const { el } = await render(
      <AspectRatio ratio={2}>
        <div>Map</div>
      </AspectRatio>,
    );
    expect(getComputedStyle(el).overflow).toBe("hidden");
    const child = el.firstElementChild!.getBoundingClientRect();
    expect(child.height).toBe(160);
  });

  it("passes attributes and a ref through, and lets layout classes win", async () => {
    let node: HTMLDivElement | null = null;
    const { el } = await render(
      <AspectRatio ratio={1} id="cover" className="w-40" ref={(element) => void (node = element)}>
        <img src={pixel} alt="" />
      </AspectRatio>,
    );
    expect(el.id).toBe("cover");
    expect(node).toBe(el);
    expect(el.getBoundingClientRect().height).toBe(160);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("AspectRatio development messages", () => {
  it.each([
    ["a 16:9 string", "16:9", 'ratio="16:9" is not a number', "<AspectRatio ratio={16 / 9}>"],
    ["a 4/3 string", "4/3", 'ratio="4/3" is not a number', "<AspectRatio ratio={4 / 3}>"],
    ["another string", "wide", 'ratio="wide" is not a number', "<AspectRatio ratio={16 / 9}>"],
    ["zero", 0, "ratio={0} is not a positive number", "<AspectRatio ratio={16 / 9}>"],
    ["NaN", Number.NaN, "ratio={NaN} is not a positive number", "<AspectRatio ratio={16 / 9}>"],
  ])("warns for %s and renders a square", async (_name, ratio, problem, fix) => {
    const props = { ratio, children: <img src={pixel} alt="" /> } as unknown as Parameters<typeof AspectRatio>[0];
    const { el } = await render(<AspectRatio {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] AspectRatio: ${problem}. Fix: ${fix}.`);
    expect(el.getBoundingClientRect().height).toBe(320);
  });

  it.each([
    ["aspectRatio", { ratio: 1, aspectRatio: 1.5 }, "aspectRatio is not a prop", "<AspectRatio ratio={1.5}>"],
    ["fit", { ratio: 1, fit: "fill" }, 'fit="fill" is not a fit; use "cover", "contain"', '<AspectRatio fit="cover">'],
  ])("warns for %s", async (_name, extra, problem, fix) => {
    const props = { children: <img src={pixel} alt="" />, ...extra } as unknown as Parameters<typeof AspectRatio>[0];
    const { el } = await render(<AspectRatio {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] AspectRatio: ${problem}. Fix: ${fix}.`);
    expect(el.hasAttribute("aspectratio")).toBe(false);
  });

  it("checks the className", async () => {
    await render(
      <AspectRatio ratio={1} className="rounded-lg">
        <img src={pixel} alt="" />
      </AspectRatio>,
    );
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] AspectRatio: "rounded-lg" sets appearance, and className is for layout only. Fix: put the AspectRatio in a <Card media={…}>, which rounds it, or wrap it in an element of your own.',
    );
  });

  it("renders to a string without warnings", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(
      <AspectRatio ratio={16 / 9}>
        <img src={pixel} alt="" />
      </AspectRatio>,
    );
    expect(html).toContain('data-ouro="aspect-ratio"');
    expect(html).toContain("aspect-ratio:1.7777");
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
