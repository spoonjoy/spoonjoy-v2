import { useState, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { SegmentedControl } from "~/components/ouro/segmented-control/segmented-control";
import { Tabs, type TabsProps } from "~/components/ouro/tabs/tabs";
import { TabsIndicator, TabsList, TabsPanel, TabsRoot, TabsTab } from "~/components/ouro/tabs/tabs-parts";
import { act } from "~/lib/ouro/testing/act";
import { pressTab } from "~/lib/ouro/testing/tab";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.padding = "24px";
  host.style.maxWidth = "560px";
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    rerender: (next: ReactNode) => act(async () => root.render(next)),
    get root() {
      return host.querySelector<HTMLElement>('[data-ouro="tabs"]')!;
    },
    get tabs() {
      return [...host.querySelectorAll<HTMLElement>('[role="tab"]')];
    },
    get indicator() {
      return host.querySelector<HTMLElement>("[data-ouro-tabs-indicator]");
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
  await page.viewport(414, 896);
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

const items = [
  { value: "ingredients", label: "Ingredients", content: <p>Two cups of flour</p> },
  { value: "method", label: "Method", content: <p>Knead for ten minutes</p> },
  { value: "notes", label: "Notes", content: <p>Rest overnight</p> },
];

/** Waits until the element's transitions have finished and two reads agree. */
async function settled(element: Element) {
  await expect.poll(() => element.getAnimations({ subtree: true }).length).toBe(0);
}

describe("Tabs", () => {
  it("renders a labelled tab list with the first tab selected and its panel shown", async () => {
    const { root, tabs } = await render(<Tabs label="Recipe" items={items} />);
    expect(root.getAttribute("data-ouro")).toBe("tabs");
    await expect.element(page.getByRole("tablist", { name: "Recipe" })).toBeVisible();
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Ingredients", "Method", "Notes"]);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    await expect.element(page.getByRole("tabpanel", { name: "Ingredients" })).toHaveTextContent("Two cups of flour");
    expect(page.getByText("Knead for ten minutes").query()).toBeNull();
  });

  it("selects a tab on click and calls onValueChange with its value", async () => {
    const onValueChange = vi.fn();
    await render(<Tabs label="Recipe" items={items} onValueChange={onValueChange} />);
    await userEvent.click(page.getByRole("tab", { name: "Method" }));
    expect(onValueChange).toHaveBeenCalledWith("method");
    await expect.element(page.getByRole("tabpanel", { name: "Method" })).toHaveTextContent("Knead for ten minutes");
  });

  it("starts on defaultValue", async () => {
    const { tabs } = await render(<Tabs label="Recipe" items={items} defaultValue="notes" />);
    expect(tabs[2]!.getAttribute("aria-selected")).toBe("true");
  });

  it("follows a controlled value", async () => {
    function Controlled() {
      const [value, setValue] = useState("method");
      return (
        <>
          <Tabs label="Recipe" items={items} value={value} onValueChange={setValue} />
          <output>{value}</output>
        </>
      );
    }
    const { host, tabs } = await render(<Controlled />);
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
    await userEvent.click(page.getByRole("tab", { name: "Notes" }));
    expect(host.querySelector("output")!.textContent).toBe("notes");
    expect(tabs[2]!.getAttribute("aria-selected")).toBe("true");
  });

  it("starts on the first enabled tab when the first is disabled", async () => {
    const { tabs } = await render(
      <Tabs label="Recipe" items={[{ ...items[0]!, disabled: true }, items[1]!, items[2]!]} />,
    );
    expect(tabs[0]!.hasAttribute("disabled") || tabs[0]!.getAttribute("aria-disabled") === "true").toBe(true);
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
  });

  it("activates a tab when the arrow keys focus it (automatic activation)", async () => {
    const { tabs } = await render(<Tabs label="Recipe" items={items} />);
    tabs[0]!.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
  });

  it("moves focus without activating with activation=\"manual\", and Enter activates", async () => {
    const { tabs } = await render(<Tabs label="Recipe" items={items} activation="manual" />);
    tabs[0]!.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    await userEvent.keyboard("{Enter}");
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
  });

  it("lays out vertically with orientation=\"vertical\" and moves with the up and down keys", async () => {
    await page.viewport(1024, 768);
    const { root, tabs } = await render(<Tabs label="Recipe" items={items} orientation="vertical" />);
    const list = root.querySelector('[role="tablist"]')!;
    expect(list.getAttribute("aria-orientation")).toBe("vertical");
    expect(tabs[1]!.getBoundingClientRect().top).toBeGreaterThan(tabs[0]!.getBoundingClientRect().top);
    expect(tabs[1]!.getBoundingClientRect().left).toBe(tabs[0]!.getBoundingClientRect().left);
    tabs[0]!.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
  });

  it("puts vertical tabs in a row above the panel on a narrow screen", async () => {
    await page.viewport(1024, 768);
    const { root, tabs } = await render(<Tabs label="Recipe" items={items} orientation="vertical" />);
    const list = root.querySelector('[role="tablist"]')!;
    expect(list.getAttribute("aria-orientation")).toBe("vertical");
    await page.viewport(390, 844);
    await expect.poll(() => list.getAttribute("data-orientation")).toBe("horizontal");
    expect(list.getAttribute("aria-orientation")).not.toBe("vertical");
    expect(root.getAttribute("data-orientation")).toBe("horizontal");
    expect(tabs[1]!.getBoundingClientRect().top).toBe(tabs[0]!.getBoundingClientRect().top);
    // The arrow keys follow the row.
    tabs[0]!.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
  });

  it("fades the edge of a tab row that scrolls, on the side with more tabs", async () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ value: `s${index}`, label: `Section ${index + 1}`, content: <p>Panel {index + 1}</p> }));
    const { host, root } = await render(<Tabs label="Recipe" items={many} />);
    host.style.width = "320px";
    const list = root.querySelector<HTMLElement>('[role="tablist"]')!;
    await expect.poll(() => list.getAttribute("data-fade")).toBe("right");
    expect(getComputedStyle(list).maskImage).toMatch(/gradient/);
    await act(async () => list.scrollTo({ left: 100 }));
    await expect.poll(() => list.getAttribute("data-fade")).toBe("both");
    await act(async () => list.scrollTo({ left: list.scrollWidth }));
    await expect.poll(() => list.getAttribute("data-fade")).toBe("left");
    // Once every tab fits, there is no fade.
    host.style.maxWidth = "none";
    host.style.width = "2000px";
    await expect.poll(() => list.hasAttribute("data-fade")).toBe(false);
    expect(getComputedStyle(list).maskImage).toBe("none");
  });

  it("fades the leading edge on the right in a right-to-left row", async () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ value: `s${index}`, label: `Section ${index + 1}`, content: <p>Panel {index + 1}</p> }));
    const { host, root } = await render(
      <div dir="rtl">
        <Tabs label="Recipe" items={many} />
      </div>,
    );
    host.style.width = "320px";
    const list = root.querySelector<HTMLElement>('[role="tablist"]')!;
    await expect.poll(() => list.getAttribute("data-fade")).toBe("left");
  });

  it("slides the indicator under the selected tab", async () => {
    const r = await render(<Tabs label="Recipe" items={items} />);
    await expect.poll(() => r.indicator).not.toBeNull();
    const indicator = r.indicator!;
    await settled(indicator);
    const under = (tab: HTMLElement) => {
      const a = indicator.getBoundingClientRect();
      const b = tab.getBoundingClientRect();
      return [Math.round(a.left - b.left) + 0, Math.round(a.width - b.width) + 0];
    };
    expect(under(r.tabs[0]!)).toEqual([0, 0]);
    let translateStarted = false;
    const record = (event: TransitionEvent) => {
      if (event.target === indicator && event.propertyName === "translate") translateStarted = true;
    };
    indicator.addEventListener("transitionrun", record);
    try {
      await userEvent.click(r.tabs[2]!);
      await settled(indicator);
      await expect.poll(() => translateStarted).toBe(true);
    } finally {
      indicator.removeEventListener("transitionrun", record);
    }
    await settled(indicator);
    expect(under(r.tabs[2]!)).toEqual([0, 0]);
  });

  it("slides the indicator with translate and resizes it with scale only, on the ease-in-out token in the base duration", async () => {
    const r = await render(<Tabs label="Recipe" items={items} />);
    await expect.poll(() => r.indicator).not.toBeNull();
    const style = getComputedStyle(r.indicator!);
    expect(style.transitionProperty).toBe("translate, scale");
    expect(style.transitionDuration).toBe("0.2s");
    expect(style.transitionTimingFunction).toBe("cubic-bezier(0.77, 0, 0.175, 1)");
    // A fixed 1px box scaled to the tab: the layout width never changes.
    expect(style.width).toBe("1px");
  });

  it("resizes the indicator between tabs of different width without ever changing its layout box, and keeps its ends square", async () => {
    const wide = [
      { value: "a", label: "Ingredients and equipment", content: <p>One</p> },
      { value: "b", label: "Go", content: <p>Two</p> },
    ];
    const r = await render(<Tabs label="Recipe" items={wide} />);
    await expect.poll(() => r.indicator).not.toBeNull();
    const indicator = r.indicator!;
    await settled(indicator);
    await expect.poll(() => Math.abs(indicator.getBoundingClientRect().width - r.tabs[0]!.getBoundingClientRect().width)).toBeLessThan(0.5);
    // Capture native transitions before input acknowledgement, which can arrive after they finish.
    const transitions = new Map<string, CSSTransition>();
    const capture = new MutationObserver(() => {
      for (const animation of indicator.getAnimations()) {
        if (animation instanceof CSSTransition && !transitions.has(animation.transitionProperty)) {
          animation.pause();
          animation.currentTime = 0;
          transitions.set(animation.transitionProperty, animation);
        }
      }
    });
    capture.observe(indicator, { attributes: true, attributeFilter: ["style"] });
    const widths = new Set<number>();
    const sizes: number[] = [];
    try {
      await userEvent.click(r.tabs[1]!);
      await expect.poll(() => [...transitions.keys()].sort()).toEqual(["scale", "translate"]);
      for (let sample = 0; sample < 20; sample++) {
        for (const animation of transitions.values()) {
          const duration = animation.effect!.getTiming().duration;
          expect(typeof duration).toBe("number");
          if (typeof duration !== "number") throw new Error("Tabs transition duration must be numeric");
          animation.currentTime = duration * sample / 20;
        }
        widths.add(indicator.offsetWidth);
        sizes.push(indicator.getBoundingClientRect().width);
      }
    } finally {
      capture.disconnect();
      for (const animation of transitions.values()) animation.finish();
    }
    await settled(indicator);
    // Only transforms changed: the box stayed 1px wide, and the drawn width moved between the two tabs.
    expect([...widths]).toEqual([1]);
    // Smooth: some sampled time draws between the old width and the new one, not just the two ends.
    const final = r.tabs[1]!.getBoundingClientRect().width;
    expect(sizes.some((size) => size > final + 5 && size < r.tabs[0]!.getBoundingClientRect().width - 5)).toBe(true);
    expect(Math.abs(indicator.getBoundingClientRect().width - r.tabs[1]!.getBoundingClientRect().width)).toBeLessThan(0.5);
    expect(getComputedStyle(indicator).borderRadius).toBe("0px");
    for (const tab of r.tabs) expect(getComputedStyle(tab).scale).toBe("none");
  });

  it("switches by key without animating the indicator or the panel, and by pointer with both", async () => {
    const r = await render(<Tabs label="Recipe" items={items} />);
    await expect.poll(() => r.indicator).not.toBeNull();
    const panel = () => r.host.querySelector<HTMLElement>('[role="tabpanel"]')!;
    expect(r.root.hasAttribute("data-ouro-keyboard")).toBe(false);
    expect(getComputedStyle(panel()).transitionProperty).toBe("opacity");
    r.tabs[0]!.focus();
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{Enter}");
    expect(r.root.hasAttribute("data-ouro-keyboard")).toBe(true);
    expect(getComputedStyle(r.indicator!).transitionProperty).toBe("none");
    expect(getComputedStyle(panel()).transitionProperty).toBe("none");
    await userEvent.click(r.tabs[2]!);
    expect(r.root.hasAttribute("data-ouro-keyboard")).toBe(false);
    expect(getComputedStyle(r.indicator!).transitionProperty).toBe("translate, scale");
    // The leaving panel has no transition (data-ending-style), so wait for the new one to be the one read.
    await expect.poll(() => getComputedStyle(panel()).transitionProperty).toBe("opacity");
  });

  it("lets a pointer anywhere inside the tabs, such as a control in a panel, end the keyboard's quiet spell", async () => {
    const r = await render(
      <Tabs
        label="Recipe"
        items={[
          { value: "a", label: "A", content: <SegmentedControl label="View" items={[{ value: "x", label: "X" }, { value: "y", label: "Y" }]} /> },
          { value: "b", label: "B", content: <p>Two</p> },
        ]}
      />,
    );
    r.tabs[0]!.focus();
    await userEvent.keyboard("{Enter}");
    expect(r.root.hasAttribute("data-ouro-keyboard")).toBe(true);
    const thumb = r.host.querySelector<HTMLElement>("[data-ouro-segment-thumb]")!;
    expect(getComputedStyle(thumb).transitionProperty).toBe("none");
    await userEvent.click(page.getByRole("radio", { name: "Y" }));
    expect(r.root.hasAttribute("data-ouro-keyboard")).toBe(false);
    expect(getComputedStyle(thumb).transitionProperty).toBe("translate, opacity");
  });

  it("still calls the key and pointer handlers a list is given", async () => {
    const onKeyDownCapture = vi.fn();
    const onPointerDownCapture = vi.fn();
    const r = await render(
      <TabsRoot defaultValue="a">
        <TabsList aria-label="Recipe" onKeyDownCapture={onKeyDownCapture} onPointerDownCapture={onPointerDownCapture}>
          <TabsTab value="a">A</TabsTab>
          <TabsTab value="b">B</TabsTab>
        </TabsList>
        <TabsPanel value="a">One</TabsPanel>
        <TabsPanel value="b">Two</TabsPanel>
      </TabsRoot>,
    );
    r.tabs[0]!.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onKeyDownCapture).toHaveBeenCalled();
    await userEvent.click(r.tabs[1]!);
    expect(onPointerDownCapture).toHaveBeenCalled();
  });

  it("keeps the indicator on the tab when it re-measures during a press", async () => {
    const r = await render(<Tabs label="Recipe" items={items} />);
    await expect.poll(() => r.indicator).not.toBeNull();
    const indicator = r.indicator!;
    const tab = r.tabs[0]!;
    await settled(indicator);
    // The press scale sits on the tab or on a wrapper inside it; either way it must reach 0.97.
    const scale = () => Math.min(...[tab, tab.firstElementChild].filter((element) => element !== null).map((element) => Number.parseFloat(getComputedStyle(element).scale) || 1));
    await commands.pointerPress({ selector: '[role="tab"][data-active]', action: "down" });
    try {
      await expect.poll(scale).toBeCloseTo(0.97, 2);
      // Resizing the list makes Base UI measure the tab again, mid-press.
      r.host.querySelector<HTMLElement>('[role="tablist"]')!.style.width = "400px";
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    } finally {
      await commands.pointerPress({ action: "up" });
    }
    await expect.poll(scale).toBeCloseTo(1, 3);
    await settled(indicator);
    expect(Math.abs(indicator.getBoundingClientRect().left - tab.getBoundingClientRect().left)).toBeLessThan(0.3);
  });

  it("moves the indicator without a transition under reduced motion", async () => {
    await commands.emulateMedia({ reducedMotion: "reduce" });
    const r = await render(<Tabs label="Recipe" items={items} />);
    await expect.poll(() => r.indicator).not.toBeNull();
    expect(getComputedStyle(r.indicator!).transitionProperty).not.toMatch(/translate|transform|scale|width|height/);
  });

  it("marks the selected tab with the foreground color and others muted", async () => {
    const { tabs } = await render(<Tabs label="Recipe" items={items} />);
    expect(getComputedStyle(tabs[0]!).color).not.toBe(getComputedStyle(tabs[1]!).color);
  });

  it("shows a focus outline on keyboard focus", async () => {
    const { tabs } = await render(<Tabs label="Recipe" items={items} />);
    await pressTab();
    expect(document.activeElement).toBe(tabs[0]);
    expect(getComputedStyle(tabs[0]!).outlineStyle).toBe("solid");
  });

  it("lets app layout classes win", async () => {
    const { root } = await render(<Tabs label="Recipe" items={items} className="mt-4" />);
    expect(getComputedStyle(root).marginTop).toBe("16px");
  });

  it("forwards a ref to the root", async () => {
    let element: HTMLDivElement | null = null;
    await render(<Tabs label="Recipe" items={items} ref={(node) => void (element = node)} />);
    expect(element).toBeInstanceOf(HTMLDivElement);
  });

  it("keeps ids and selection in server HTML and hydrates without a mismatch", async () => {
    const node = <Tabs label="Recipe" items={items} defaultValue="method" />;
    const html = renderToString(node);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Recipe"');
    expect(html).toContain("Knead for ten minutes");
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    mounted.push(host);
    const tab = host.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!;
    const panel = host.querySelector<HTMLElement>('[role="tabpanel"]')!;
    expect(tab.textContent).toBe("Method");
    expect(tab.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
    const recoverable = vi.fn();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(host, node, { onRecoverableError: recoverable });
    });
    roots.push(root);
    expect(recoverable).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    await userEvent.click(host.querySelectorAll<HTMLElement>('[role="tab"]')[2]!);
    await expect.poll(() => [...host.querySelectorAll('[role="tabpanel"]')].map((panel) => panel.textContent)).toEqual(["Rest overnight"]);
  });
});

describe("Tabs development messages", () => {
  it.each([
    ["onChange", { onChange: () => {} }, "onChange is not a prop", "<Tabs onValueChange={(value) => …}>"],
    ["activateOnFocus", { activateOnFocus: false }, "activateOnFocus is not a prop", '<Tabs activation="manual">'],
    ["tabs", { tabs: [] }, "tabs is not a prop", '<Tabs items={[{ value, label, content }]}>'],
    ["orientation", { orientation: "row" }, 'orientation="row" is not an orientation; use "horizontal", "vertical"', '<Tabs orientation="horizontal">'],
    ["activation", { activation: "focus" }, 'activation="focus" is not an activation; use "automatic", "manual"', '<Tabs activation="automatic">'],
    ["unknown defaultValue", { defaultValue: "steps" }, 'defaultValue="steps" matches no item', '<Tabs defaultValue="ingredients">'],
    ["unknown value", { value: "steps" }, 'value="steps" matches no item', '<Tabs value="ingredients">'],
  ])("warns for %s with the fix", async (_name, extra, problem, fix) => {
    const props = { label: "Recipe", items, ...extra } as unknown as TabsProps;
    const { root } = await render(<Tabs {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Tabs: ${problem}. Fix: ${fix}.`);
    expect(root.hasAttribute("activateonfocus")).toBe(false);
    expect(root.hasAttribute("tabs")).toBe(false);
  });

  it("points activateOnFocus={true} to automatic activation", async () => {
    const props = { label: "Recipe", items, activateOnFocus: true } as unknown as TabsProps;
    await render(<Tabs {...props} />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] Tabs: activateOnFocus is not a prop. Fix: <Tabs activation="automatic">.');
  });

  it("names a placeholder value when there are no items", async () => {
    await render(<Tabs label="Recipe" items={[]} defaultValue="steps" />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] Tabs: defaultValue="steps" matches no item. Fix: <Tabs defaultValue="…">.');
  });

  it("selects nothing when every tab is disabled", async () => {
    const { tabs } = await render(<Tabs label="Recipe" items={items.map((item) => ({ ...item, disabled: true }))} />);
    expect(tabs.some((tab) => tab.getAttribute("aria-selected") === "true")).toBe(false);
  });

  it("renders horizontal automatic tabs for an unknown orientation and activation", async () => {
    const props = { label: "Recipe", items, orientation: "row", activation: "focus" } as unknown as TabsProps;
    const { root, tabs } = await render(<Tabs {...props} />);
    expect(root.querySelector('[role="tablist"]')!.getAttribute("data-orientation")).toBe("horizontal");
    tabs[0]!.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
  });

  it("throws for two items with one value", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderToString(<Tabs label="Recipe" items={[items[0]!, items[0]!]} />)).toThrow(
      '[ouro-ui] Tabs: two items have the value "ingredients". Fix: give each item its own value.',
    );
    error.mockRestore();
  });

  it.each([
    ["bg-muted", 'remove "bg-muted"; Tabs sets its own look'],
    ["text-center", "<div className=\"text-center\"><Tabs /></div>"],
  ])("checks the className %s", async (className, fix) => {
    await render(<Tabs label="Recipe" items={items} className={className} />);
    const kind = className.startsWith("text-center") ? "aligns content" : "sets appearance";
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Tabs: "${className}" ${kind}, and className is for layout only. Fix: ${fix}.`);
  });

  it("renders to a string without warnings", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(<Tabs label="Recipe" items={items} className="bg-red-500" />);
    expect(html).toContain('data-ouro="tabs"');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("Tabs parts", () => {
  it("builds tabs from parts", async () => {
    const { tabs } = await render(
      <TabsRoot defaultValue="b">
        <TabsList aria-label="Parts">
          <TabsTab value="a">A</TabsTab>
          <TabsTab value="b">B</TabsTab>
          <TabsIndicator />
        </TabsList>
        <TabsPanel value="a">Panel A</TabsPanel>
        <TabsPanel value="b">Panel B</TabsPanel>
      </TabsRoot>,
    );
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
    await expect.element(page.getByRole("tabpanel")).toHaveTextContent("Panel B");
    await userEvent.click(tabs[0]!);
    await expect.element(page.getByRole("tabpanel")).toHaveTextContent("Panel A");
  });

  it("checks the parts' classNames", async () => {
    await render(
      <TabsRoot defaultValue="a" className="bg-muted">
        <TabsList aria-label="Parts" className="border-red-500">
          <TabsTab value="a" className="text-red-500">
            A
          </TabsTab>
        </TabsList>
        <TabsPanel value="a" className="shadow-lg">
          Panel A
        </TabsPanel>
      </TabsRoot>,
    );
    for (const [part, token] of [
      ["TabsRoot", "bg-muted"],
      ["TabsList", "border-red-500"],
      ["TabsTab", "text-red-500"],
      ["TabsPanel", "shadow-lg"],
    ]) {
      expect(warn).toHaveBeenCalledWith(
        `[ouro-ui] ${part}: "${token}" sets appearance, and className is for layout only. Fix: remove "${token}"; ${part} sets its own look.`,
      );
    }
  });

  it.each([
    ["TabsList", () => <TabsList aria-label="x" />, "<TabsList aria-label=\"…\">…</TabsList>"],
    ["TabsTab", () => <TabsTab value="a">A</TabsTab>, '<TabsTab value="…">…</TabsTab>'],
    ["TabsIndicator", () => <TabsIndicator />, "<TabsIndicator />"],
    ["TabsPanel", () => <TabsPanel value="a">A</TabsPanel>, '<TabsPanel value="…">…</TabsPanel>'],
  ])("throws for %s outside TabsRoot with the JSX it belongs in", async (part, make, inner) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderToString(make())).toThrow(`[ouro-ui] ${part}: must be rendered inside <TabsRoot>. Fix: `);
    expect(() => renderToString(make())).toThrow(inner.slice(0, 12));
    error.mockRestore();
  });
});
