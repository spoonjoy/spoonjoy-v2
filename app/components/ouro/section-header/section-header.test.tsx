import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { SectionHeader } from "~/components/ouro/section-header/section-header";
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
    get header() {
      return host.querySelector<HTMLElement>('[data-ouro="section-header"]')!;
    },
    part(name: string) {
      return host.querySelector<HTMLElement>(`[data-slot="${name}"]`);
    },
  };
}

/** A theme value, computed on a probe in the page. */
function themed(property: "color" | "borderTopColor" | "fontFamily", value: string) {
  const probe = document.createElement("span");
  if (property === "borderTopColor") probe.style.borderColor = value;
  else probe.style[property] = value;
  document.body.append(probe);
  mounted.push(probe);
  return getComputedStyle(probe)[property];
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await page.viewport(414, 896);
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

const full = <SectionHeader title="Your recipes" meta="2 recipes · 2 cookbooks" actions={<a href="#all">See all</a>} />;

describe("SectionHeader", () => {
  it("is the section's h2 in the theme's heading font", async () => {
    const { header } = await render(full);
    await expect.element(page.getByRole("heading", { level: 2, name: "Your recipes" })).toBeVisible();
    expect(header.tagName).toBe("DIV");
    expect(getComputedStyle(header.querySelector("h2")!).fontFamily).toBe(themed("fontFamily", "var(--font-heading)"));
  });

  it("sets the meta in small tracked capitals in the muted color, after the title", async () => {
    const { header, part } = await render(full);
    const meta = getComputedStyle(part("meta")!);
    expect(meta.textTransform).toBe("uppercase");
    expect(Number.parseFloat(meta.letterSpacing)).toBeGreaterThan(0);
    expect(Number.parseFloat(meta.fontSize)).toBeLessThan(Number.parseFloat(getComputedStyle(header.querySelector("h2")!).fontSize));
    expect(meta.color).toBe(themed("color", "var(--muted-foreground)"));
    expect(meta.marginTop).toBe("0px");
    expect(part("meta")!.getBoundingClientRect().left).toBeGreaterThanOrEqual(header.querySelector("h2")!.getBoundingClientRect().right);
  });

  it("keeps the action on the title's row on a phone, with the meta between them", async () => {
    await page.viewport(390, 844);
    const { header, part } = await render(<div style={{ width: 358 }}>{full}</div>);
    const title = header.querySelector("h2")!.getBoundingClientRect();
    const action = part("actions")!.getBoundingClientRect();
    expect(action.top).toBeLessThan(title.bottom);
    expect(action.right).toBeCloseTo(358, 0);
    expect(part("meta")!.getBoundingClientRect().right).toBeLessThanOrEqual(action.left);
  });

  it("wraps the meta under the title where the row is too narrow for both, and never runs past the row", async () => {
    const { header, part } = await render(
      <div style={{ width: 240 }}>
        <SectionHeader title="Weeknight dinners" meta="12 recipes · 3 cookbooks" actions={<a href="#all">See all</a>} />
      </div>,
    );
    expect(part("meta")!.getBoundingClientRect().top).toBeGreaterThanOrEqual(header.querySelector("h2")!.getBoundingClientRect().bottom - 1);
    expect(header.scrollWidth).toBeLessThanOrEqual(240);
  });

  it("draws a hairline in the border color under the row, and none with divider false", async () => {
    const { host } = await render(
      <>
        <SectionHeader title="Ruled" />
        <SectionHeader title="Plain" divider={false} />
      </>,
    );
    const [ruled, plain] = [...host.querySelectorAll<HTMLElement>('[data-ouro="section-header"]')].map((element) => getComputedStyle(element));
    expect(ruled!.borderBottomWidth).toBe("1px");
    expect(ruled!.borderTopWidth).toBe("0px");
    expect(ruled!.borderBottomColor).toBe(themed("borderTopColor", "var(--border)"));
    expect(plain!.borderBottomWidth).toBe("0px");
  });

  it("heads a section inside a section as an h3 with level={3}, set smaller", async () => {
    const { host } = await render(
      <>
        <SectionHeader title="Shelves" />
        <SectionHeader title="Desserts" level={3} />
      </>,
    );
    await expect.element(page.getByRole("heading", { level: 3, name: "Desserts" })).toBeVisible();
    const [two, three] = [...host.querySelectorAll("h2, h3")].map((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(two).toBeGreaterThan(three!);
  });

  it("renders only the title when it has nothing else", async () => {
    const { header } = await render(<SectionHeader title="Plain" />);
    expect(header.querySelectorAll("[data-slot]")).toHaveLength(0);
    expect(header.textContent).toBe("Plain");
  });

  it("forwards a ref, passes attributes through, and its margin is the app's", async () => {
    let element: HTMLDivElement | null = null;
    const { header } = await render(<SectionHeader title="Ref" className="mt-8" id="shelf" ref={(node) => void (element = node)} />);
    expect(element).toBe(header);
    expect(header.id).toBe("shelf");
    expect(getComputedStyle(header).marginTop).toBe("32px");
  });
});

describe("SectionHeader development messages", () => {
  it.each([
    ["level", { level: 4 }, "level={4} is not a level; use 2 or 3", "<SectionHeader level={3} />"],
    ["count", { count: "12 recipes" }, "count is not a prop", '<SectionHeader meta="12 recipes" />'],
    ["count", { count: 12 }, "count is not a prop", '<SectionHeader meta="12" />'],
    ["count", { count: <b>12</b> }, "count is not a prop", '<SectionHeader meta="..." />'],
    ["description", { description: "Two shelves" }, "description is not a prop", '<SectionHeader meta="2 shelves" />'],
    ["action", { action: <a href="#all">See all</a> }, "action is not a prop", '<SectionHeader actions={<Link href="...">See all</Link>} />'],
    ["heading", { heading: "Recipes" }, "heading is not a prop", '<SectionHeader title="Recipes" />'],
    ["heading", { heading: true }, "heading is not a prop", '<SectionHeader title="..." />'],
  ])("explains %s with the fix", async (_name, extra, problem, fix) => {
    const props = { title: "T", ...extra } as unknown as Parameters<typeof SectionHeader>[0];
    const { header } = await render(<SectionHeader {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] SectionHeader: ${problem}. Fix: ${fix}.`);
    for (const name of ["count", "description", "action", "heading"]) expect(header.hasAttribute(name)).toBe(false);
  });

  it("renders an h2 for an unknown level", async () => {
    const props = { title: "T", level: 4 } as unknown as Parameters<typeof SectionHeader>[0];
    const { header } = await render(<SectionHeader {...props} />);
    expect(header.querySelector("h2")).not.toBeNull();
  });

  it.each([
    ["bg-muted", 'remove "bg-muted"; SectionHeader sets its own look from the theme'],
    ["mt-8", ""],
  ])("checks the className %s", async (className, fix) => {
    await render(<SectionHeader title="T" className={className} />);
    if (fix) expect(warn).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^\\[ouro-ui\\] SectionHeader: "${className}".*${fix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)));
    else expect(warn).not.toHaveBeenCalled();
  });

  it("renders to a string", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(full);
    expect(html).toContain('data-ouro="section-header"');
    expect(html).toContain("<h2");
    expect(error).not.toHaveBeenCalled();
  });
});
