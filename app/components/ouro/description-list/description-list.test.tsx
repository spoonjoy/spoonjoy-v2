import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { DescriptionList } from "~/components/ouro/description-list/description-list";
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
  return { host, list: host.querySelector<HTMLElement>('[data-ouro="description-list"]')! };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await page.viewport(1280, 800);
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

const items = [
  { term: "Prep time", details: "20 minutes" },
  { term: "Cook time", details: "4 hours" },
  { term: "Serves", details: <strong>6</strong> },
];

function boxes(list: HTMLElement) {
  return [...list.children].map((child) => ({ tag: child.tagName, rect: child.getBoundingClientRect() }));
}

describe("DescriptionList", () => {
  it("renders each item as a term and its details, in order", async () => {
    const { list } = await render(<DescriptionList items={items} />);
    expect(list.tagName).toBe("DL");
    expect([...list.children].map((child) => [child.tagName, child.textContent])).toEqual([
      ["DT", "Prep time"],
      ["DD", "20 minutes"],
      ["DT", "Cook time"],
      ["DD", "4 hours"],
      ["DT", "Serves"],
      ["DD", "6"],
    ]);
  });

  it("puts each term beside its details from 640px, in one shared column of terms", async () => {
    await page.viewport(1280, 800);
    const { list } = await render(<DescriptionList items={items} />);
    const [dt1, dd1, dt2, dd2] = boxes(list);
    expect(dd1!.rect.top).toBe(dt1!.rect.top);
    expect(dd1!.rect.left).toBeGreaterThanOrEqual(dt1!.rect.right);
    expect(dd2!.rect.left).toBe(dd1!.rect.left);
    expect(dt2!.rect.top).toBeGreaterThanOrEqual(dd1!.rect.bottom - 1);
    // A line between the pairs, none above the first.
    expect(getComputedStyle(list.children[0]!).borderTopWidth).toBe("0px");
    expect(getComputedStyle(list.children[1]!).borderTopWidth).toBe("0px");
    expect(getComputedStyle(list.children[2]!).borderTopWidth).toBe("1px");
    expect(getComputedStyle(list.children[3]!).borderTopWidth).toBe("1px");
    // Each term's text lines up with its details' text.
    expect(getComputedStyle(list.children[0]!).paddingTop).toBe(getComputedStyle(list.children[1]!).paddingTop);
    expect(getComputedStyle(list.children[2]!).paddingTop).toBe(getComputedStyle(list.children[3]!).paddingTop);
    // A mouse gets 14px text; a touch screen keeps 16px (description-list.touch.test.tsx).
    expect(getComputedStyle(list.children[0]!).fontSize).toBe("14px");
  });

  it("stacks each term above its details on a phone", async () => {
    await page.viewport(390, 844);
    const { list } = await render(<DescriptionList items={items} />);
    const [dt1, dd1, dt2] = boxes(list);
    expect(dd1!.rect.top).toBeGreaterThanOrEqual(dt1!.rect.bottom - 1);
    expect(dd1!.rect.left).toBe(dt1!.rect.left);
    expect(dt2!.rect.top).toBeGreaterThanOrEqual(dd1!.rect.bottom - 1);
    // The line runs above each term, not between a term and its details.
    expect(getComputedStyle(list.children[2]!).borderTopWidth).toBe("1px");
    expect(getComputedStyle(list.children[3]!).borderTopWidth).toBe("0px");
  });

  it("breaks a long URL or email instead of widening the page on a phone", async () => {
    await page.viewport(390, 844);
    const { list } = await render(
      <div style={{ padding: "0 16px" }}>
        <DescriptionList
          items={[
            { term: "Website", details: "https://example.com/a/very/long/path/that/never/breaks/on/its/own/recipes/braised-short-ribs" },
            { term: "averyveryverylongtermwithoutanyspacesatall", details: "averyveryverylongemailaddresswithnospaces@example.com" },
          ]}
        />
      </div>,
    );
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    for (const cell of list.children) expect(cell.scrollWidth).toBeLessThanOrEqual(cell.clientWidth);
  });

  it("stacks until 768px with stackBelow=md", async () => {
    await page.viewport(700, 800);
    const { list: md } = await render(<DescriptionList items={items} stackBelow="md" />);
    const [dt, dd] = boxes(md);
    expect(dd!.rect.top).toBeGreaterThanOrEqual(dt!.rect.bottom - 1);
    const { list: sm } = await render(<DescriptionList items={items} />);
    const [smDt, smDd] = boxes(sm);
    expect(smDd!.rect.top).toBe(smDt!.rect.top);
  });

  it("passes attributes and a ref through, and lets layout classes win", async () => {
    let element: HTMLDListElement | null = null;
    const { list } = await render(<DescriptionList items={items} id="facts" className="mt-4" ref={(node) => void (element = node)} aria-label="Recipe facts" />);
    expect(list.id).toBe("facts");
    expect(list.getAttribute("aria-label")).toBe("Recipe facts");
    expect(getComputedStyle(list).marginTop).toBe("16px");
    expect(element).toBe(list);
  });
});

describe("DescriptionList development messages", () => {
  it.each([
    ["data", { data: items, items: undefined }, "data is not a prop", "<DescriptionList items={[{ term: …, details: … }]}>"],
    ["children", { children: "x" }, "children are not rendered; the list comes from items", '<DescriptionList items={[{ term: "Prep time", details: "20 minutes" }]}>'],
    ["stackBelow", { stackBelow: "lg" }, 'stackBelow="lg" is not a breakpoint; use "sm", "md"', '<DescriptionList stackBelow="sm">'],
  ])("warns for %s with the fix", async (_name, extra, problem, fix) => {
    await render(<DescriptionList {...({ items, ...extra } as unknown as Parameters<typeof DescriptionList>[0])} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] DescriptionList: ${problem}. Fix: ${fix}.`);
  });

  it.each([
    ["label", { label: "Prep time", details: "20 minutes" }, "an item's label is not a prop", '{ term: "Prep time", details: … }'],
    ["value", { term: "Prep time", value: "20 minutes" }, "an item's value is not a prop", '{ term: …, details: "20 minutes" }'],
    ["description", { term: "Prep time", description: "20 minutes" }, "an item's description is not a prop", '{ term: …, details: "20 minutes" }'],
  ])("warns for an item's %s with the fix, and shows it", async (_name, item, problem, fix) => {
    const { list } = await render(<DescriptionList {...({ items: [item] } as unknown as Parameters<typeof DescriptionList>[0])} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] DescriptionList: ${problem}. Fix: ${fix}.`);
    expect(list.textContent).toBe("Prep time20 minutes");
  });

  it("renders an empty list and names the fix without items", async () => {
    const { list } = await render(<DescriptionList {...({} as unknown as Parameters<typeof DescriptionList>[0])} />);
    expect(list.children).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] DescriptionList: items is required; it holds the pairs. Fix: <DescriptionList items={[{ term: "Prep time", details: "20 minutes" }]}>.',
    );
    warn.mockClear();
    await render(<DescriptionList {...({ data: items } as unknown as Parameters<typeof DescriptionList>[0])} />);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("stacks below sm for an unknown breakpoint", async () => {
    await page.viewport(700, 800);
    const { list } = await render(<DescriptionList {...({ items, stackBelow: "lg" } as unknown as Parameters<typeof DescriptionList>[0])} />);
    const [dt, dd] = boxes(list);
    expect(dd!.rect.top).toBe(dt!.rect.top);
  });

  it("checks the className", async () => {
    await render(<DescriptionList items={items} className="text-lg" />);
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] DescriptionList: "text-lg" sets appearance, and className is for layout only. Fix: pass styled content in details, such as <Text size="lg">.',
    );
  });

  it("renders to a string without warnings", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(<DescriptionList items={items} className="bg-red-500" />);
    expect(html).toContain('data-ouro="description-list"');
    expect(html).toContain("<dt");
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
