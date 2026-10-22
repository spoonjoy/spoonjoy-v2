import { useState, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import {
  SegmentedControl,
  type SegmentedControlProps,
} from "~/components/ouro/segmented-control/segmented-control";
import { act } from "~/lib/ouro/testing/act";
import { pressTab } from "~/lib/ouro/testing/tab";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.padding = "24px";
  host.style.width = "420px";
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    rerender: (next: ReactNode) => act(async () => root.render(next)),
    get root() {
      return host.querySelector<HTMLElement>('[data-ouro="segmented-control"]')!;
    },
    get segments() {
      return [...host.querySelectorAll<HTMLButtonElement>("[data-ouro-segment]")];
    },
    get thumb() {
      return host.querySelector<HTMLElement>("[data-ouro-segment-thumb]")!;
    },
  };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await commands.emulateMedia({ reducedMotion: "no-preference" });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

const items = [
  { value: "list", label: "List" },
  { value: "grid", label: "Grid" },
  { value: "map", label: "Map" },
];

async function settled(element: Element) {
  await expect.poll(() => element.getAnimations({ subtree: true }).length).toBe(0);
}

describe("SegmentedControl", () => {
  it("renders a labelled radio group with the first segment checked", async () => {
    const { root, segments } = await render(<SegmentedControl label="View" items={items} />);
    expect(root.getAttribute("data-ouro")).toBe("segmented-control");
    await expect.element(page.getByRole("radiogroup", { name: "View" })).toBeVisible();
    expect(segments.map((segment) => segment.textContent)).toEqual(["List", "Grid", "Map"]);
    expect(segments.map((segment) => segment.getAttribute("role"))).toEqual(["radio", "radio", "radio"]);
    expect(segments.map((segment) => segment.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(segments.some((segment) => segment.hasAttribute("aria-pressed"))).toBe(false);
    await expect.element(page.getByRole("radio", { name: "List" })).toBeChecked();
    await expect.element(page.getByText("View", { exact: true })).toBeVisible();
  });

  it("hides the label visually with hideLabel, and still names the group", async () => {
    const { host } = await render(<SegmentedControl label="View" hideLabel items={items} />);
    await expect.element(page.getByRole("radiogroup", { name: "View" })).toBeInTheDocument();
    const label = [...host.querySelectorAll("span")].find((span) => span.textContent === "View")!;
    expect(label.getBoundingClientRect().width).toBeLessThanOrEqual(1);
  });

  it("presses a segment on click and calls onValueChange with its value", async () => {
    const onValueChange = vi.fn();
    const { segments } = await render(<SegmentedControl label="View" items={items} onValueChange={onValueChange} />);
    await userEvent.click(segments[1]!);
    expect(onValueChange).toHaveBeenCalledWith("grid");
    expect(segments.map((segment) => segment.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
  });

  it("keeps one segment pressed: pressing the pressed one again does nothing", async () => {
    const onValueChange = vi.fn();
    const { segments } = await render(<SegmentedControl label="View" items={items} onValueChange={onValueChange} />);
    await userEvent.click(segments[0]!);
    expect(onValueChange).not.toHaveBeenCalled();
    expect(segments[0]!.getAttribute("aria-checked")).toBe("true");
  });

  it("starts on defaultValue and follows a controlled value", async () => {
    function Controlled() {
      const [value, setValue] = useState("map");
      return (
        <>
          <SegmentedControl label="View" items={items} value={value} onValueChange={setValue} />
          <output>{value}</output>
        </>
      );
    }
    const { host, segments } = await render(<Controlled />);
    expect(segments[2]!.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(segments[0]!);
    expect(host.querySelector("output")!.textContent).toBe("list");
    expect(segments[0]!.getAttribute("aria-checked")).toBe("true");
    const other = await render(<SegmentedControl label="Other" items={items} defaultValue="grid" />);
    expect(other.segments[1]!.getAttribute("aria-checked")).toBe("true");
  });

  it("selects with the arrow keys, as radio buttons do, and tabs to the checked segment", async () => {
    const onValueChange = vi.fn();
    const { segments } = await render(<SegmentedControl label="View" items={items} defaultValue="grid" onValueChange={onValueChange} />);
    await pressTab();
    expect(document.activeElement).toBe(segments[1]);
    expect(onValueChange).not.toHaveBeenCalled();
    expect(getComputedStyle(segments[1]!).outlineStyle).toBe("solid");
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(segments[2]);
    expect(onValueChange).toHaveBeenLastCalledWith("map");
    expect(segments.map((segment) => segment.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(document.activeElement).toBe(segments[0]);
    expect(segments[0]!.getAttribute("aria-checked")).toBe("true");
    // Space on the checked segment keeps it checked.
    await userEvent.keyboard(" ");
    expect(segments[0]!.getAttribute("aria-checked")).toBe("true");
    expect(onValueChange).toHaveBeenCalledTimes(3);
  });

  it("never reports the checked value again, even after an arrow key that moves nowhere", async () => {
    const onValueChange = vi.fn();
    const only = [items[0]!, { ...items[1]!, disabled: true }, { ...items[2]!, disabled: true }];
    const { segments } = await render(
      <>
        <SegmentedControl label="View" items={only} onValueChange={onValueChange} />
        <button>After</button>
      </>,
    );
    await pressTab();
    expect(document.activeElement).toBe(segments[0]);
    // The only enabled segment: the arrow key keeps focus where it is.
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(segments[0]);
    // Leave with the pointer, so no key clears the arrow, then come back with the keyboard.
    await userEvent.click(page.getByRole("button", { name: "After" }));
    await pressTab({ shift: true });
    expect(document.activeElement).toBe(segments[0]);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("reports a pointer press once after an arrow key that moved nowhere", async () => {
    const onValueChange = vi.fn();
    // Controlled, with the app not yet updating value, so each report shows.
    const { segments } = await render(<SegmentedControl label="View" items={items} value="list" onValueChange={onValueChange} />);
    await pressTab();
    expect(document.activeElement).toBe(segments[0]);
    // Up in a row moves nowhere.
    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(segments[0]);
    expect(onValueChange).not.toHaveBeenCalled();
    await userEvent.click(segments[1]!);
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith("grid");
  });

  it("never reports the checked value when the arrow keys come back to it", async () => {
    const onValueChange = vi.fn();
    // Controlled, with the app not updating value: "list" stays checked.
    const { segments } = await render(<SegmentedControl label="View" items={items} value="list" onValueChange={onValueChange} />);
    await pressTab();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(segments[1]);
    await userEvent.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(segments[0]);
    expect(onValueChange.mock.calls).toEqual([["grid"]]);
  });

  it("skips a disabled segment with the arrow keys", async () => {
    const { segments } = await render(<SegmentedControl label="View" items={[items[0]!, { ...items[1]!, disabled: true }, items[2]!]} />);
    await pressTab();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(segments[2]);
    expect(segments[2]!.getAttribute("aria-checked")).toBe("true");
  });

  it("submits the checked value with a form when given a name", async () => {
    const { host, segments } = await render(
      <form>
        <SegmentedControl label="View" name="view" items={items} defaultValue="grid" />
      </form>,
    );
    const form = host.querySelector("form")!;
    expect(new FormData(form).get("view")).toBe("grid");
    await userEvent.click(segments[2]!);
    expect(new FormData(form).get("view")).toBe("map");
    const unnamed = await render(
      <form>
        <SegmentedControl label="View" items={items} />
      </form>,
    );
    expect([...new FormData(unnamed.host.querySelector("form")!).keys()]).toEqual([]);
    // With nothing checked, the name submits an empty value.
    const empty = await render(
      <form>
        <SegmentedControl label="View" name="view" items={items.map((item) => ({ ...item, disabled: true }))} />
      </form>,
    );
    expect(new FormData(empty.host.querySelector("form")!).get("view")).toBe("");
    // A disabled control submits nothing, as a disabled native control does.
    const disabled = await render(
      <form>
        <SegmentedControl label="View" name="view" items={items} defaultValue="grid" disabled />
      </form>,
    );
    expect([...new FormData(disabled.host.querySelector("form")!).keys()]).toEqual([]);
  });

  it("gives every segment the same width", async () => {
    const { segments } = await render(
      <SegmentedControl label="View" items={[{ value: "a", label: "A" }, { value: "b", label: "A much longer label" }]} />,
    );
    const [a, b] = segments.map((segment) => segment.getBoundingClientRect().width);
    expect(Math.abs(a! - b!)).toBeLessThan(1);
  });

  it("stretches to its container with fullWidth", async () => {
    const { root, host } = await render(<SegmentedControl label="View" items={items} fullWidth hideLabel />);
    const group = root.querySelector('[role="radiogroup"]')!;
    expect(Math.round(group.getBoundingClientRect().width)).toBe(Math.round(host.getBoundingClientRect().width - 48));
  });

  it("slides the thumb under the pressed segment with a transition", async () => {
    const r = await render(<SegmentedControl label="View" items={items} />);
    const thumb = r.thumb;
    const offset = (segment: HTMLElement) => Math.round(thumb.getBoundingClientRect().left - segment.getBoundingClientRect().left) + 0;
    // Within a pixel: the thumb's width is a fraction of the track, and WebKit rounds it.
    expect(Math.abs(offset(r.segments[0]!))).toBeLessThanOrEqual(1);
    let translateStarted = false;
    const record = (event: TransitionEvent) => {
      if (event.target === thumb && event.propertyName === "translate") translateStarted = true;
    };
    thumb.addEventListener("transitionrun", record);
    try {
      await userEvent.click(r.segments[2]!);
      await settled(thumb);
      await expect.poll(() => translateStarted).toBe(true);
    } finally {
      thumb.removeEventListener("transitionrun", record);
    }
    await settled(thumb);
    expect(Math.abs(offset(r.segments[2]!))).toBeLessThanOrEqual(1);
    expect(Math.abs(thumb.getBoundingClientRect().width - r.segments[2]!.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
  });

  it("puts the thumb under the pressed segment in a right-to-left page, where the first segment is on the right", async () => {
    const r = await render(
      <div dir="rtl">
        <SegmentedControl label="View" items={items} defaultValue="grid" />
      </div>,
    );
    await settled(r.thumb);
    const [first, second] = [r.segments[0]!.getBoundingClientRect(), r.segments[1]!.getBoundingClientRect()];
    expect(first.left).toBeGreaterThan(second.left);
    expect(Math.abs(r.thumb.getBoundingClientRect().left - second.left)).toBeLessThanOrEqual(1);
    await userEvent.click(r.segments[0]!);
    await settled(r.thumb);
    expect(Math.abs(r.thumb.getBoundingClientRect().left - r.segments[0]!.getBoundingClientRect().left)).toBeLessThanOrEqual(1);
  });

  it("keeps its edge and shows the pressed segment under forced colours", async () => {
    await commands.emulateMedia({ forcedColors: "active" });
    try {
      const r = await render(<SegmentedControl label="View" items={items} defaultValue="grid" />);
      const group = r.segments[0]!.parentElement!;
      // Forced colours drop the track's and the thumb's fills, so the track draws a border and the
      // thumb and pressed segment take the system's Highlight pair.
      expect(parseFloat(getComputedStyle(group).borderTopWidth)).toBeGreaterThan(0);
      expect(getComputedStyle(group).borderTopStyle).toBe("solid");
      expect(getComputedStyle(r.segments[1]!).color).not.toBe(getComputedStyle(r.segments[0]!).color);
      expect(getComputedStyle(r.thumb).backgroundColor).not.toBe(getComputedStyle(group).backgroundColor);
    } finally {
      await commands.emulateMedia({ forcedColors: "none" });
    }
  });

  it("slides the thumb on the ease-in-out token, and moves it at once on an arrow key", async () => {
    const r = await render(<SegmentedControl label="View" items={items} />);
    const style = () => getComputedStyle(r.thumb);
    expect(style().transitionProperty).toBe("translate, opacity");
    expect(style().transitionDuration).toBe("0.2s, 0.15s");
    expect(style().transitionTimingFunction).toBe("cubic-bezier(0.77, 0, 0.175, 1), ease");
    r.segments[0]!.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(r.thumb.parentElement!.hasAttribute("data-ouro-keyboard")).toBe(true);
    expect(style().transitionProperty).toBe("none");
    await userEvent.click(r.segments[2]!);
    expect(r.thumb.parentElement!.hasAttribute("data-ouro-keyboard")).toBe(false);
    expect(style().transitionProperty).toBe("translate, opacity");
  });

  it("moves the thumb without a transition under reduced motion", async () => {
    await commands.emulateMedia({ reducedMotion: "reduce" });
    const { thumb } = await render(<SegmentedControl label="View" items={items} />);
    expect(getComputedStyle(thumb).transitionProperty).not.toMatch(/translate|transform/);
  });

  it("hides the thumb when no item has the value", async () => {
    const props = { label: "View", items, value: "table" } as SegmentedControlProps;
    const { thumb } = await render(<SegmentedControl {...props} />);
    expect(getComputedStyle(thumb).opacity).toBe("0");
  });

  it("disables one segment, or the whole control", async () => {
    const { segments, rerender } = await render(
      <SegmentedControl label="View" items={[items[0]!, { ...items[1]!, disabled: true }, items[2]!]} />,
    );
    expect(segments[1]!.disabled).toBe(true);
    await rerender(<SegmentedControl label="View" items={items} disabled />);
    expect(segments.every((segment) => segment.disabled)).toBe(true);
  });

  it("lets app layout classes win", async () => {
    const { root } = await render(<SegmentedControl label="View" items={items} className="mt-4" />);
    expect(getComputedStyle(root).marginTop).toBe("16px");
  });

  it("forwards a ref to the group", async () => {
    let element: HTMLDivElement | null = null;
    await render(<SegmentedControl label="View" items={items} ref={(node) => void (element = node)} />);
    expect(element!.getAttribute("role")).toBe("radiogroup");
  });

  it("keeps the label id and pressed state in server HTML and hydrates without a mismatch", async () => {
    const node = <SegmentedControl label="View" items={items} defaultValue="grid" />;
    const html = renderToString(node);
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    mounted.push(host);
    const group = host.querySelector('[role="radiogroup"]')!;
    const labelId = group.getAttribute("aria-labelledby")!;
    expect(host.querySelector(`[id="${labelId}"]`)!.textContent).toBe("View");
    expect(host.querySelector('[aria-checked="true"]')!.textContent).toBe("Grid");
    const recoverable = vi.fn();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(host, node, { onRecoverableError: recoverable });
    });
    roots.push(root);
    expect(recoverable).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    await userEvent.click(host.querySelectorAll<HTMLElement>("[data-ouro-segment]")[2]!);
    expect(host.querySelector('[aria-checked="true"]')!.textContent).toBe("Map");
  });
});

describe("SegmentedControl development messages", () => {
  it.each([
    ["options", { options: items }, "options is not a prop", "<SegmentedControl items={[{ value, label }]}>"],
    ["onChange", { onChange: () => {} }, "onChange is not a prop", "<SegmentedControl onValueChange={(value) => …}>"],
    ["unknown value", { value: "table" }, 'value="table" matches no item', '<SegmentedControl value="list">'],
    ["unknown defaultValue", { defaultValue: "table" }, 'defaultValue="table" matches no item', '<SegmentedControl defaultValue="list">'],
    ["href", { items: [{ value: "a", label: "A", href: "/a" }] }, "a segment switches a view in place, so it has no href", "<Tabs> or links in a <nav>"],
  ])("warns for %s with the fix", async (_name, extra, problem, fix) => {
    const props = { label: "View", items, ...extra } as unknown as SegmentedControlProps;
    const { root } = await render(<SegmentedControl {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] SegmentedControl: ${problem}. Fix: ${fix}.`);
    expect(root.querySelector("[options]")).toBeNull();
    expect(root.querySelector("[href]")).toBeNull();
  });

  it("names a placeholder value and presses nothing when there are no items", async () => {
    const { segments, thumb } = await render(<SegmentedControl label="View" items={[]} value="table" defaultValue="grid" />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] SegmentedControl: value="table" matches no item. Fix: <SegmentedControl value="…">.');
    expect(warn).toHaveBeenCalledWith('[ouro-ui] SegmentedControl: defaultValue="grid" matches no item. Fix: <SegmentedControl defaultValue="…">.');
    expect(segments).toHaveLength(0);
    expect(getComputedStyle(thumb).opacity).toBe("0");
  });

  it("presses nothing when every segment is disabled", async () => {
    const { segments } = await render(<SegmentedControl label="View" items={items.map((item) => ({ ...item, disabled: true }))} />);
    expect(segments.every((segment) => segment.getAttribute("aria-checked") === "false")).toBe(true);
  });

  it("throws for two items with one value", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderToString(<SegmentedControl label="View" items={[items[0]!, items[0]!]} />)).toThrow(
      '[ouro-ui] SegmentedControl: two items have the value "list". Fix: give each item its own value.',
    );
    error.mockRestore();
  });

  it("checks the className", async () => {
    await render(<SegmentedControl label="View" items={items} className="bg-muted" />);
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] SegmentedControl: "bg-muted" sets appearance, and className is for layout only. Fix: remove "bg-muted"; SegmentedControl sets its own look.',
    );
  });

  it("renders to a string without warnings", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(<SegmentedControl label="View" items={items} className="bg-red-500" />);
    expect(html).toContain('data-ouro="segmented-control"');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
