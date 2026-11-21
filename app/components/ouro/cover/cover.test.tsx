import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { Cover } from "~/components/ouro/cover/cover";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    get cover() {
      return host.querySelector<HTMLElement>('[data-ouro="cover"]')!;
    },
  };
}

/** A theme value, computed on a probe in the page. */
function themed(property: "color" | "fontFamily" | "borderTopLeftRadius", value: string) {
  const probe = document.createElement("span");
  if (property === "borderTopLeftRadius") probe.className = value;
  else probe.style[property] = value;
  document.body.append(probe);
  mounted.push(probe);
  return getComputedStyle(probe)[property];
}

// A 2×2 PNG, so the picture loads with no network.
const PICTURE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGNk+M/wn4GBgYGJAQoAAOkBAvQ9wZEAAAAASUVORK5CYII=";

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

describe("Cover", () => {
  it("keeps its fixed sizes at a compact --spacing", async () => {
    const { host } = await render(
      <>
        <Cover title="lemon rice" size="sm" />
        <Cover title="lemon rice" />
        <Cover title="lemon rice" size="lg" />
      </>,
    );
    const widths = () => [...host.querySelectorAll<HTMLElement>('[data-ouro="cover"]')].map((cover) => getComputedStyle(cover).width);
    expect(widths()).toEqual(["40px", "56px", "96px"]);
    host.style.setProperty("--spacing", "0.2rem");
    expect(widths()).toEqual(["40px", "56px", "96px"]);
  });
  it("draws the title's first letter in the heading font, in the primary toward the foreground, on a wash from the muted color toward the primary, without a picture", async () => {
    const { cover } = await render(<Cover title="  lemon rice" />);
    const letter = cover.querySelector("span")!;
    expect(letter.textContent).toBe("L");
    expect(letter.getAttribute("aria-hidden")).toBe("true");
    expect(getComputedStyle(letter).fontFamily).toBe(themed("fontFamily", "var(--font-heading)"));
    expect(getComputedStyle(letter).color).toBe(themed("color", "color-mix(in oklab, var(--primary) 60%, var(--foreground))"));
    expect(getComputedStyle(cover).backgroundImage).toMatch(/^linear-gradient\(135deg/);
    // The letter is 42% of the tile's height.
    expect(Number.parseFloat(getComputedStyle(letter).fontSize)).toBeCloseTo(56 * 0.42, 0);
  });

  it("keeps an emoji's first character whole, and draws nothing for a blank title", async () => {
    const { host } = await render(
      <>
        <Cover title="🍋 tart" />
        <Cover title="   " />
      </>,
    );
    const [emoji, blank] = [...host.querySelectorAll<HTMLElement>('[data-ouro="cover"]')];
    expect(emoji!.textContent).toBe("🍋");
    expect(blank!.textContent).toBe("");
  });

  it("takes the wash and the letter's color from the theme's cover tokens", async () => {
    const { cover } = await render(
      <div style={{ ["--ouro-cover-from" as string]: "rgb(1, 2, 3)", ["--ouro-cover-to" as string]: "rgb(4, 5, 6)", ["--ouro-cover-ink" as string]: "rgb(7, 8, 9)" }}>
        <Cover title="Rice" />
      </div>,
    );
    expect(getComputedStyle(cover).backgroundImage).toBe("linear-gradient(135deg, rgb(1, 2, 3), rgb(4, 5, 6))");
    expect(getComputedStyle(cover.querySelector("span")!).color).toBe("rgb(7, 8, 9)");
  });

  it("shows the picture over the whole tile, cropped to fill it", async () => {
    const { cover } = await render(<Cover title="Rice" src={PICTURE} size="lg" />);
    const img = cover.querySelector("img")!;
    await expect.poll(() => img.complete && img.naturalWidth).toBe(2);
    expect(getComputedStyle(img).objectFit).toBe("cover");
    expect(img.getBoundingClientRect().width).toBe(96);
    expect(img.getBoundingClientRect().height).toBe(96);
    expect(cover.querySelector("span")).toBeNull();
  });

  it("falls back to the initial when the picture fails to load", async () => {
    const { cover } = await render(<Cover title="Rice" src="data:image/png;base64,broken" />);
    await expect.poll(() => cover.querySelector("img")).toBeNull();
    expect(cover.textContent).toBe("R");
  });

  it("draws the initial for an empty address, and the new picture once the address changes", async () => {
    const { host, cover } = await render(<Cover title="Rice" src="" />);
    expect(cover.textContent).toBe("R");
    expect(cover.querySelector("img")).toBeNull();
    const root = roots.at(-1)!;
    await act(async () => root.render(<Cover title="Rice" src="data:image/png;base64,broken" />));
    await expect.poll(() => host.querySelector("img")).toBeNull();
    await act(async () => root.render(<Cover title="Rice" src={PICTURE} />));
    expect(host.querySelector("img")!.getAttribute("src")).toBe(PICTURE);
  });

  it("is decoration without alt, and an image named by alt with it, picture or initial", async () => {
    await render(
      <>
        <Cover title="Plain" />
        <Cover title="Rice" alt="Lemon rice in a blue bowl" src={PICTURE} />
        <Cover title="Soup" alt="Cover for Soup" />
      </>,
    );
    await expect.element(page.getByRole("img", { name: "Lemon rice in a blue bowl" })).toBeInTheDocument();
    await expect.element(page.getByRole("img", { name: "Cover for Soup" })).toBeInTheDocument();
    expect(page.getByRole("img").elements()).toHaveLength(2);
    // Only the initial with alt is itself an image: a plain cover is decoration, and a picture's <img> carries the name.
    const covers = [...document.querySelectorAll<HTMLElement>('[data-ouro="cover"]')];
    expect(covers.map((cover) => [cover.getAttribute("role"), cover.getAttribute("aria-label")])).toEqual([
      [null, null],
      [null, null],
      ["img", "Cover for Soup"],
    ]);
  });

  it("is 40, 56 and 96px square at sm, md and lg, and as wide as its container at fill", async () => {
    const { host } = await render(
      <div style={{ width: 300 }}>
        <Cover title="A" size="sm" />
        <Cover title="B" />
        <Cover title="C" size="lg" />
        <Cover title="D" size="fill" />
        <Cover title="E" size="fill" className="aspect-video" />
      </div>,
    );
    const boxes = [...host.querySelectorAll<HTMLElement>('[data-ouro="cover"]')].map((element) => element.getBoundingClientRect());
    expect(boxes.map((box) => [box.width, box.height])).toEqual([
      [40, 40],
      [56, 56],
      [96, 96],
      [300, 300],
      [300, 168.75],
    ]);
  });

  it("rounds on the theme's lg corner, or not at all with shape square", async () => {
    const { host } = await render(
      <>
        <Cover title="A" />
        <Cover title="B" shape="square" />
      </>,
    );
    const [rounded, square] = [...host.querySelectorAll<HTMLElement>('[data-ouro="cover"]')].map((element) => getComputedStyle(element).borderTopLeftRadius);
    expect(rounded).toBe(themed("borderTopLeftRadius", "rounded-ouro-lg"));
    expect(Number.parseFloat(rounded!)).toBeGreaterThan(0);
    expect(square).toBe("0px");
    expect([...host.querySelectorAll('[data-ouro="cover"]')].map((element) => element.getAttribute("data-shape"))).toEqual(["rounded", "square"]);
  });

  it("forwards a ref and passes attributes through", async () => {
    let element: HTMLDivElement | null = null;
    const { cover } = await render(<Cover title="Ref" id="cover" className="mt-2" ref={(node) => void (element = node)} />);
    expect(element).toBe(cover);
    expect(cover.id).toBe("cover");
    expect(getComputedStyle(cover).marginTop).toBe("8px");
  });
});

describe("Cover development messages", () => {
  it.each([
    ["size", { size: "xl" }, 'size="xl" is not a size; use "sm", "md", "lg" or "fill"', '<Cover size="md" />'],
    ["shape", { shape: "circle" }, 'shape="circle" is not a shape; use "rounded" or "square"', '<Cover shape="square" />'],
    ["image", { image: "/a.png" }, "image is not a prop", "<Cover src={url} />"],
    ["name", { name: "Rice" }, "name is not a prop", '<Cover title="Rice" />'],
    ["name", { name: 1 }, "name is not a prop", '<Cover title="..." />'],
    ["initials", { initials: "R" }, "initials is not a prop", '<Cover title="..." />'],
  ])("explains %s with the fix", async (_name, extra, problem, fix) => {
    const props = { title: "T", ...extra } as unknown as Parameters<typeof Cover>[0];
    const { cover } = await render(<Cover {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Cover: ${problem}. Fix: ${fix}.`);
    for (const name of ["image", "name", "initials"]) expect(cover.hasAttribute(name)).toBe(false);
  });

  it("renders the md, rounded cover for an unknown size and shape", async () => {
    const props = { title: "T", size: "xl", shape: "circle" } as unknown as Parameters<typeof Cover>[0];
    const { cover } = await render(<Cover {...props} />);
    expect(cover.getAttribute("data-size")).toBe("md");
    expect(cover.getAttribute("data-shape")).toBe("rounded");
  });

  it.each([
    ["bg-muted", 'remove "bg-muted"; Cover sets its own look from the theme'],
    ["aspect-video", ""],
  ])("checks the className %s", async (className, fix) => {
    await render(<Cover title="T" size="fill" className={className} />);
    if (fix) expect(warn).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^\\[ouro-ui\\] Cover: "${className}".*${fix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)));
    else expect(warn).not.toHaveBeenCalled();
  });

  it("renders to a string, with the picture or the initial", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(renderToString(<Cover title="Rice" />)).toContain(">R<");
    expect(renderToString(<Cover title="Rice" src="/rice.jpg" />)).toContain('src="/rice.jpg"');
    expect(error).not.toHaveBeenCalled();
  });
});
