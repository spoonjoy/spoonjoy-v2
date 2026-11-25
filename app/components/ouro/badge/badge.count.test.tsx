import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Badge } from "~/components/ouro/badge/badge";
import { act } from "~/lib/ouro/testing/act";

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

async function mount(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

describe("Badge count", () => {
  it("is a small round pill, with white semibold tabular figures, that grows with its number", async () => {
    const page = await mount(
      <>
        <Badge count>3</Badge>
        <Badge count>12</Badge>
      </>,
    );
    const [one, two] = [...page.querySelectorAll<HTMLElement>('[data-ouro="badge"]')] as [HTMLElement, HTMLElement];
    const style = getComputedStyle(one);
    expect(one.getBoundingClientRect().height).toBe(16);
    expect(one.getBoundingClientRect().width).toBeGreaterThanOrEqual(16);
    expect(two.getBoundingClientRect().width).toBeGreaterThan(one.getBoundingClientRect().width);
    expect(style.fontSize).toBe("10px");
    expect(style.fontWeight).toBe("600");
    expect(style.fontVariantNumeric).toContain("tabular-nums");
    expect(style.color).toBe("rgb(255, 255, 255)");
    expect(parseFloat(style.borderTopLeftRadius)).toBeGreaterThanOrEqual(7);
    expect(style.backgroundColor).toMatch(/^(rgb|color)\(/);
    expect(style.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  });

  it("draws its fill from --ouro-count, so a theme can set it", async () => {
    const page = await mount(
      <div style={{ ["--ouro-count" as string]: "rgb(1, 2, 3)" }}>
        <Badge count>3</Badge>
      </div>,
    );
    expect(getComputedStyle(page.querySelector<HTMLElement>('[data-ouro="badge"]')!).backgroundColor).toBe("rgb(1, 2, 3)");
  });

  it("with overlay sits at a fixed offset from the corner of its positioned parent, set by variables", async () => {
    const page = await mount(
      <div data-parent style={{ position: "relative", width: 40, height: 40, ["--ouro-count-x" as string]: "-2px", ["--ouro-count-y" as string]: "3px" }}>
        <Badge count overlay>
          3
        </Badge>
      </div>,
    );
    const parent = page.querySelector<HTMLElement>("[data-parent]")!.getBoundingClientRect();
    const badge = page.querySelector<HTMLElement>('[data-ouro="badge"]')!.getBoundingClientRect();
    expect(getComputedStyle(page.querySelector<HTMLElement>('[data-ouro="badge"]')!).position).toBe("absolute");
    expect(parent.right - badge.right).toBeCloseTo(-2, 0);
    expect(badge.top - parent.top).toBeCloseTo(3, 0);
  });

  it("is left alone by an ordinary badge without count", async () => {
    const page = await mount(<Badge>3</Badge>);
    expect(page.querySelector<HTMLElement>('[data-ouro="badge"]')!.getBoundingClientRect().height).toBeGreaterThan(16);
  });

  it("ignores overlay without count", async () => {
    const page = await mount(<Badge overlay>3</Badge>);
    expect(getComputedStyle(page.querySelector<HTMLElement>('[data-ouro="badge"]')!).position).not.toBe("absolute");
  });
});
