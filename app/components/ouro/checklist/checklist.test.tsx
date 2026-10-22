import { useLayoutEffect, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Button } from "~/components/ouro/button/button";
import { Checklist, type ChecklistItemData, type ChecklistProps } from "~/components/ouro/checklist/checklist";
import { ChecklistItem, ChecklistRoot } from "~/components/ouro/checklist/checklist-parts";
import { act } from "~/lib/ouro/testing/act";
import { watchAnnouncements } from "~/lib/ouro/testing/announcements";
import { expectMotion, expectTransition, parseDuration } from "~/lib/ouro/testing/motion";
import { pressTab } from "~/lib/ouro/testing/tab";

const roots: Root[] = [];
let mounted: Element[] = [];

const ingredients: ChecklistItemData[] = [
  { id: "oats", label: "rolled oats", value: "1 cup", checked: false },
  { id: "milk", label: "milk", value: "2 cups", checked: false },
  { id: "salt", label: "salt", value: "a pinch", checked: false },
];

/** How a test changes the list its host holds, as an app's state would change. */
let setList: (update: (items: ChecklistItemData[]) => ChecklistItemData[]) => void = () => {};
/** Every `onCheckedChange` call the host received, in order. */
let changes: Array<[string, boolean]> = [];

/** A checklist whose items live in state that follows its changes, as an app's would. */
function Host(props: { items?: ChecklistItemData[]; extra?: Partial<ChecklistProps> }) {
  const [items, setItems] = useState(props.items ?? ingredients);
  useLayoutEffect(() => {
    setList = (update) => setItems(update);
  }, []);
  return (
    <Checklist
      label="Ingredients"
      items={items}
      onCheckedChange={(id, checked) => {
        changes.push([id, checked]);
        setItems((list) => list.map((item) => (item.id === id ? { ...item, checked } : item)));
      }}
      onClearChecked={() => setItems((list) => list.map((item) => ({ ...item, checked: false })))}
      {...props.extra}
    />
  );
}

async function render(node: ReactNode, attributes: Record<string, string> = {}) {
  const host = document.createElement("div");
  host.style.padding = "24px";
  host.style.maxWidth = "420px";
  for (const [name, value] of Object.entries(attributes)) host.setAttribute(name, value);
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  // The rows are styled before a person can change them, so a change transitions from that style.
  await frame();
  return {
    host,
    rerender: (next: ReactNode) => act(async () => root.render(next)),
    get root() {
      return host.querySelector<HTMLElement>('[data-ouro="checklist"]')!;
    },
    rows: () => [...host.querySelectorAll<HTMLElement>('[data-ouro-part="row"]')],
    row: (label: string) => [...host.querySelectorAll<HTMLElement>('[data-ouro-part="row"]')].find((row) => row.querySelector('[data-ouro-part="label"]')?.textContent === label)!,
  };
}

/** One part of a row. */
const partOf = (row: HTMLElement, part: string) => row.querySelector<HTMLElement>(`[data-ouro-part="${part}"]`)!;

/** The labels of the rendered rows, leaving ones included, in order. */
const labels = (host: HTMLElement) => [...host.querySelectorAll('[data-ouro-part="label"]')].map((label) => label.textContent);

/** A duration token's value in milliseconds. */
const duration = (token: string) => parseDuration(getComputedStyle(document.documentElement).getPropertyValue(token));

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** Every animation still running in the element or below it. */
const running = (element: Element) => element.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running");

/** A theme variable as the browser computes it, so the test holds under any shadcn theme. */
function themeColor(variable: string): string {
  const probe = document.createElement("div");
  probe.style.color = `var(${variable})`;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

/** A color's sRGB channels and alpha, from canvas pixels, so any color syntax compares. */
function rgba(color: string): [number, number, number, number] {
  const context = document.createElement("canvas").getContext("2d")!;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  return [r!, g!, b!, a!];
}

/** WCAG contrast between two opaque colors. */
function contrast(a: string, b: string): number {
  const luminance = (color: string) => {
    const [r, g, b] = rgba(color)
      .slice(0, 3)
      .map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/** The color behind an element: the first element around it that paints an opaque one. */
function backdrop(element: Element): string {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    if (rgba(color)[3] === 255) return color;
  }
  return "rgb(255, 255, 255)";
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  changes = [];
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
  document.documentElement.classList.remove("dark");
  await commands.emulateMedia({ reducedMotion: "no-preference" });
});

describe("Checklist", () => {
  it("names the group and each row by its label", async () => {
    await render(<Host />);
    await expect.element(page.getByRole("group", { name: "Ingredients" })).toBeVisible();
    await expect.element(page.getByRole("checkbox", { name: "rolled oats", exact: true })).not.toBeChecked();
    // The value describes the row: "rolled oats, checkbox, not checked, 1 cup".
    await expect.element(page.getByRole("checkbox", { name: "rolled oats" })).toHaveAccessibleDescription("1 cup");
  });

  it("checks a row from anywhere on it, and reports the id", async () => {
    const { row } = await render(<Host />);
    await userEvent.click(partOf(row("rolled oats"), "value"));
    expect(changes).toEqual([["oats", true]]);
    await expect.element(page.getByRole("checkbox", { name: "rolled oats" })).toBeChecked();
    await userEvent.click(partOf(row("milk"), "label"));
    expect(changes).toEqual([
      ["oats", true],
      ["milk", true],
    ]);
  });

  it("toggles with Space and keeps focus on the row", async () => {
    await render(<Host />);
    const box = page.getByRole("checkbox", { name: "rolled oats" });
    (box.element() as HTMLElement).focus();
    await userEvent.keyboard(" ");
    await expect.element(box).toBeChecked();
    expect(document.activeElement).toBe(box.element());
    expect(changes).toEqual([["oats", true]]);
  });

  it("draws the tick, then the strike, and softens the text", async () => {
    const { row } = await render(<Host />);
    const oats = row("rolled oats");
    const [box, tick, strike, label, value] = ["box", "tick", "strike", "label", "value"].map((part) => partOf(oats, part)) as [HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    const fast = duration("--ouro-duration-fast");
    const draw = duration("--ouro-duration-draw");
    expect(getComputedStyle(label).color).toBe(themeColor("--foreground"));
    for (const [state, reduced] of [
      ["data-checked", false],
      ["data-unchecked", false],
      ["data-checked", true],
      ["data-unchecked", true],
    ] as const) {
      await commands.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      await expect.poll(() => running(oats).length).toBe(0);
      // No await between the click and the motion checks: act's await ends on a later task, and a
      // loaded browser can run a 150ms transition to its end before that task comes.
      flushSync(() => box.click());
      const checking = state === "data-checked";
      if (checking && !reduced) {
        // The box fills, the tick draws once it has, and the strike follows the tick.
        const delay = (element: Element) => Number(element.getAnimations()[0]!.effect!.getComputedTiming().delay);
        expect((strike.getAnimations()[0] as CSSTransition).transitionProperty).toBe("scale");
        expect(delay(tick)).toBe(fast);
        expect(delay(strike)).toBeGreaterThan(delay(tick));
      }
      const color = { color: reduced || !checking ? fast : draw };
      await Promise.all([
        expectMotion(box, { stem: "checklist", state, properties: { "background-color": fast, "border-color": fast }, reduced }),
        expectMotion(tick, { stem: "checklist", state, properties: reduced ? { opacity: fast } : { "stroke-dashoffset": checking ? draw : fast }, reduced }),
        expectMotion(strike, { stem: "checklist", state, properties: reduced ? { opacity: fast } : { scale: checking ? draw : fast }, reduced }),
        expectMotion(label, { stem: "checklist", state, properties: color, reduced }),
        expectMotion(value, { stem: "checklist", state, properties: color, reduced }),
      ]);
      if (checking) {
        expect(Number.parseFloat(getComputedStyle(strike).scale) || 1).toBe(1);
        expect(getComputedStyle(label).color).toBe(themeColor("--muted-foreground"));
        expect(getComputedStyle(value).color).toBe(themeColor("--muted-foreground"));
      } else {
        expect(getComputedStyle(label).color).toBe(themeColor("--foreground"));
      }
    }
  });

  it("ends in the last state when toggled twice during its animation", async () => {
    const { row } = await render(<Host />);
    const oats = row("rolled oats");
    const box = partOf(oats, "box");
    // A row a person can click has been styled, so its change transitions from its first style.
    await frame();
    await act(() => box.click());
    await frame();
    expect(running(oats).length).toBeGreaterThan(0);
    await act(() => box.click());
    expectTransition({ stem: "checklist", from: "data-checked", to: "data-unchecked", interrupt: true });
    expect(changes).toEqual([
      ["oats", true],
      ["oats", false],
    ]);
    await expect.poll(() => running(oats).length).toBe(0);
    expect(box).toHaveAttribute("aria-checked", "false");
    expect(Number.parseFloat(getComputedStyle(partOf(oats, "strike")).scale)).toBe(0);
    expect(Number.parseFloat(getComputedStyle(partOf(oats, "tick")).strokeDashoffset)).toBe(1);
    expect(getComputedStyle(partOf(oats, "label")).color).toBe(themeColor("--foreground"));
  });

  it("only fades and recolours under reduced motion", async () => {
    await commands.emulateMedia({ reducedMotion: "reduce" });
    const { row } = await render(<Host />);
    const oats = row("rolled oats");
    await frame();
    await act(() => partOf(oats, "box").click());
    const properties = running(oats).map((animation) => (animation as CSSTransition).transitionProperty);
    expect(properties.length).toBeGreaterThan(0);
    for (const moving of ["scale", "stroke-dashoffset", "transform", "translate", "grid-template-rows"]) expect(properties).not.toContain(moving);
    await expect.poll(() => running(oats).length).toBe(0);
    // The strike is whole and only fades.
    expect(Number.parseFloat(getComputedStyle(partOf(oats, "strike")).scale) || 1).toBe(1);
    // WebKit can report the fade done a frame before its last value lands.
    await expect.poll(() => getComputedStyle(partOf(oats, "strike")).opacity).toBe("1");
  });

  it("mirrors the strike right to left", async () => {
    const { row } = await render(<Host />, { dir: "rtl" });
    const oats = row("rolled oats");
    const strike = partOf(oats, "strike");
    const fast = duration("--ouro-duration-fast");
    const draw = duration("--ouro-duration-draw");
    // The strike grows from the inline start, which is the right in right-to-left text.
    const [x] = getComputedStyle(strike).transformOrigin.split(" ").map(Number.parseFloat);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeCloseTo(strike.offsetWidth, 0);
    flushSync(() => partOf(oats, "box").click());
    await Promise.all([
      expectMotion(strike, { stem: "checklist", state: "data-checked", properties: { scale: draw }, reduced: false, dir: "rtl" }),
      expectMotion(partOf(oats, "tick"), { stem: "checklist", state: "data-checked", properties: { "stroke-dashoffset": draw }, reduced: false, dir: "rtl" }),
      expectMotion(partOf(oats, "box"), { stem: "checklist", state: "data-checked", properties: { "background-color": fast, "border-color": fast }, reduced: false, dir: "rtl" }),
      expectMotion(partOf(oats, "label"), { stem: "checklist", state: "data-checked", properties: { color: draw }, reduced: false, dir: "rtl" }),
      expectMotion(partOf(oats, "value"), { stem: "checklist", state: "data-checked", properties: { color: draw }, reduced: false, dir: "rtl" }),
    ]);
    const ltr = await render(<Host />);
    const [ltrX] = getComputedStyle(partOf(ltr.row("rolled oats"), "strike")).transformOrigin.split(" ").map(Number.parseFloat);
    expect(ltrX).toBe(0);
  });

  it("shows Clear checked only when something is checked, and calls onClearChecked", async () => {
    await render(<Host />);
    const clear = page.getByRole("button", { name: "Clear checked" });
    await expect.element(clear).not.toBeInTheDocument();
    await userEvent.click(page.getByRole("checkbox", { name: "milk" }));
    await expect.element(clear).toBeVisible();
    await userEvent.click(clear);
    await expect.element(page.getByRole("checkbox", { name: "milk" })).not.toBeChecked();
    await expect.element(clear).not.toBeInTheDocument();
    // Focus does not fall to the page when the button goes: it moves to the first row.
    expect(document.activeElement).toBe(page.getByRole("checkbox", { name: "rolled oats" }).element());
  });

  it("names the clear button with clearLabel, and shows none without onClearChecked", async () => {
    const checked = ingredients.map((item) => ({ ...item, checked: true }));
    const { rerender } = await render(<Host items={checked} extra={{ clearLabel: "Start over" }} />);
    await expect.element(page.getByRole("button", { name: "Start over" })).toBeVisible();
    await rerender(<Checklist label="Ingredients" items={checked} onCheckedChange={() => {}} />);
    await expect.element(page.getByRole("button", { name: "Start over" })).not.toBeInTheDocument();
  });

  it("shows empty when there are no items", async () => {
    const { root } = await render(<Host items={[]} extra={{ empty: <p>Nothing to buy.</p> }} />);
    await expect.element(page.getByText("Nothing to buy.")).toBeVisible();
    expect(root.querySelectorAll('[data-ouro-part="row"]')).toHaveLength(0);
    await act(() => setList(() => [{ id: "eggs", label: "eggs", checked: false }]));
    await expect.element(page.getByText("Nothing to buy.")).not.toBeInTheDocument();
  });

  it("shows the empty state once the last row has left", async () => {
    const { host } = await render(<Host items={[{ id: "eggs", label: "eggs", checked: true }]} extra={{ empty: <p>Nothing to buy.</p> }} />);
    flushSync(() => setList(() => []));
    expect(host.querySelector('[data-ouro-part="row"][data-ending-style]')).not.toBeNull();
    expect(host.textContent).not.toContain("Nothing to buy.");
    await expect.poll(() => host.querySelectorAll('[data-ouro-part="row"]').length).toBe(0);
    await expect.element(page.getByText("Nothing to buy.")).toBeVisible();
  });

  it("keeps a row's own action its own tab stop", async () => {
    const onAction = vi.fn();
    const items = ingredients.map((item, index) =>
      index === 0
        ? {
            ...item,
            action: (
              <Button variant="plain" size="sm" onClick={onAction}>
                Swap
              </Button>
            ),
          }
        : item,
    );
    const { row } = await render(<Host items={items} />);
    const oats = row("rolled oats");
    const action = page.getByRole("button", { name: "Swap" });
    // The action sits beside the row's label, not inside it, so it is no part of the checkbox's name.
    const label = oats.querySelector("label")!;
    expect(label.contains(action.element())).toBe(false);
    (page.getByRole("checkbox", { name: "rolled oats" }).element() as HTMLElement).focus();
    await pressTab();
    expect(document.activeElement).toBe(action.element());
    await userEvent.click(action);
    expect(onAction).toHaveBeenCalledOnce();
    expect(changes).toEqual([]);
    // The empty space between the value and the action is still the row's label.
    const box = label.getBoundingClientRect();
    await userEvent.click(label, { position: { x: box.width - 4, y: box.height / 2 } });
    expect(changes).toEqual([["oats", true]]);
  });

  it("disables a row's box and fades it", async () => {
    const items = ingredients.map((item, index) => ({ ...item, disabled: index === 1 }));
    const { row } = await render(<Host items={items} />);
    await expect.element(page.getByRole("checkbox", { name: "milk" })).toBeDisabled();
    await userEvent.click(partOf(row("milk"), "label"), { force: true });
    expect(changes).toEqual([]);
    expect(getComputedStyle(partOf(row("milk"), "box")).opacity).toBe("0.5");
  });

  it("fades the box when a row becomes disabled after it renders, with reduced motion too", async () => {
    const { row } = await render(<Host />);
    const milk = row("milk");
    const fast = duration("--ouro-duration-fast");
    for (const reduced of [false, true]) {
      await commands.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      await expect.poll(() => running(milk).length).toBe(0);
      flushSync(() => setList((list) => list.map((item) => (item.id === "milk" ? { ...item, disabled: true } : item))));
      await expectMotion(partOf(milk, "box"), { stem: "checklist", state: "data-disabled", properties: { opacity: fast }, reduced });
      await act(() => setList((list) => list.map((item) => ({ ...item, disabled: false }))));
    }
  });

  it("keeps a removed row until its exit finishes", async () => {
    const { host, row } = await render(<Host />);
    const base = duration("--ouro-duration-base");
    const fast = duration("--ouro-duration-fast");
    const milk = row("milk");
    // A row a person sees has been styled, so its exit transitions from that style.
    await frame();
    flushSync(() => setList((list) => list.filter((item) => item.id !== "milk")));
    expect(milk.isConnected).toBe(true);
    expect(milk).toHaveAttribute("data-ending-style");
    expect(milk).toHaveAttribute("inert");
    expect(milk).toHaveAttribute("aria-hidden", "true");
    await expectMotion(milk, { stem: "checklist", state: "data-ending-style", properties: { opacity: base, "grid-template-rows": base }, reduced: false });
    await expect.poll(() => milk.isConnected).toBe(false);
    expect(labels(host)).toEqual(["rolled oats", "salt"]);
    // With reduced motion the row only fades, in place, and then goes.
    await commands.emulateMedia({ reducedMotion: "reduce" });
    const salt = row("salt");
    flushSync(() => setList((list) => list.filter((item) => item.id !== "salt")));
    await expectMotion(salt, { stem: "checklist", state: "data-ending-style", properties: { opacity: fast }, reduced: true });
    await expect.poll(() => salt.isConnected).toBe(false);
  });

  it("brings a new row in", async () => {
    const { row } = await render(<Host />);
    const base = duration("--ouro-duration-base");
    const fast = duration("--ouro-duration-fast");
    for (const reduced of [false, true]) {
      await commands.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      const id = reduced ? "eggs" : "butter";
      // No await before the checks: the row is entering only for its 150-200ms transition, which
      // a loaded browser can run to its end before act's await comes back.
      flushSync(() => setList((list) => [...list, { id, label: id, checked: false }]));
      const added = row(id);
      expect(added).toHaveAttribute("data-starting-style");
      await expectMotion(added, { stem: "checklist", state: "data-starting-style", properties: reduced ? { opacity: fast } : { opacity: base, "grid-template-rows": base }, reduced });
      await expect.poll(() => added.hasAttribute("data-starting-style")).toBe(false);
      expect(getComputedStyle(added).opacity).toBe("1");
    }
  });

  it("renders its first rows without an entrance", async () => {
    const { rows } = await render(<Host />);
    for (const row of rows()) {
      expect(row).not.toHaveAttribute("data-starting-style");
      expect(row.getAnimations()).toEqual([]);
    }
  });

  it("returns a row re-added while leaving", async () => {
    const { host, row } = await render(<Host />);
    const milk = row("milk");
    flushSync(() => setList((list) => list.filter((item) => item.id !== "milk")));
    expect(milk).toHaveAttribute("data-ending-style");
    await frame();
    flushSync(() => setList(() => ingredients));
    expect(milk).not.toHaveAttribute("data-ending-style");
    expect(milk).not.toHaveAttribute("inert");
    expect(milk).not.toHaveAttribute("aria-hidden");
    await expect.poll(() => running(milk).length).toBe(0);
    await frame();
    expect(milk.isConnected).toBe(true);
    expect(labels(host)).toEqual(["rolled oats", "milk", "salt"]);
    expect(getComputedStyle(milk).opacity).toBe("1");
  });

  it("exits even when its action animates forever", async () => {
    const spinner = <span role="img" aria-label="Saving" className="inline-block size-4 animate-[ouro-spin_1s_linear_infinite]" />;
    const items = ingredients.map((item) => (item.id === "milk" ? { ...item, action: spinner } : item));
    const { row } = await render(<Host items={items} />);
    const milk = row("milk");
    expect(milk.getAnimations({ subtree: true }).some((animation) => animation.effect?.getComputedTiming().iterations === Infinity)).toBe(true);
    await act(() => setList((list) => list.filter((item) => item.id !== "milk")));
    await expect.poll(() => milk.isConnected).toBe(false);
  });

  it("survives rapid removals", async () => {
    const many = Array.from({ length: 8 }, (_, index) => ({ id: `item-${index}`, label: `item ${index}`, checked: index % 2 === 0 }));
    const { host } = await render(<Host items={many} />);
    for (const index of [1, 3, 5, 0, 7]) {
      await act(() => setList((list) => list.filter((item) => item.id !== `item-${index}`)));
      await frame();
    }
    await expect.poll(() => host.querySelectorAll('[data-ouro-part="row"]').length).toBe(3);
    expect(labels(host)).toEqual(["item 2", "item 4", "item 6"]);
    // At rest: rows that slid under a resting mouse may fade a hover in, and then all is still.
    await expect.poll(() => running(host).length).toBe(0);
  });

  it("keeps rows in order while one leaves and another arrives", async () => {
    const { host } = await render(<Host />);
    flushSync(() => setList((list) => [list[0]!, { id: "eggs", label: "eggs", checked: false }, list[2]!]));
    // The leaving row stays after the row it followed.
    expect(labels(host)).toEqual(["rolled oats", "milk", "eggs", "salt"]);
    await expect.poll(() => host.querySelectorAll('[data-ouro-part="row"]').length).toBe(3);
    expect(labels(host)).toEqual(["rolled oats", "eggs", "salt"]);
  });

  it("moves focus to the next row when the focused row leaves", async () => {
    const { root } = await render(<Host />);
    (page.getByRole("checkbox", { name: "milk" }).element() as HTMLElement).focus();
    await act(() => setList((list) => list.filter((item) => item.id !== "milk")));
    expect(document.activeElement).toBe(page.getByRole("checkbox", { name: "salt" }).element());
    await act(() => setList((list) => list.filter((item) => item.id !== "salt")));
    expect(document.activeElement).toBe(page.getByRole("checkbox", { name: "rolled oats" }).element());
    await act(() => setList(() => []));
    expect(document.activeElement).toBe(root);
  });

  it("announces nothing extra", async () => {
    await render(<Host />);
    const announcements = watchAnnouncements();
    await userEvent.click(page.getByRole("checkbox", { name: "rolled oats" }));
    await expect.element(page.getByRole("checkbox", { name: "rolled oats" })).toBeChecked();
    await act(() => setList((list) => list.filter((item) => item.id !== "milk")));
    await frame();
    expect(announcements.changes).toEqual([]);
    announcements.stop();
  });

  it("keeps 4.5:1 for checked text in light and dark", async () => {
    const checked = ingredients.map((item) => ({ ...item, checked: true, description: "for the base" }));
    for (const scheme of ["light", "dark"]) {
      document.documentElement.classList.toggle("dark", scheme === "dark");
      const { row } = await render(
        <div style={{ background: "var(--background)" }}>
          <Host items={checked} />
        </div>,
      );
      const oats = row("rolled oats");
      await expect.poll(() => running(oats).length).toBe(0);
      for (const part of [partOf(oats, "label"), partOf(oats, "value"), oats.querySelector<HTMLElement>("[data-ouro-checklist-description]")!]) {
        expect(contrast(getComputedStyle(part).color, backdrop(part)), `${scheme} ${part.textContent}`).toBeGreaterThanOrEqual(4.5);
      }
      await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    }
  });

  it("hides the label visually with hideLabel and keeps the group's name and description", async () => {
    const { root } = await render(<Host extra={{ hideLabel: true, description: "For four bowls." }} />);
    await expect.element(page.getByRole("group", { name: "Ingredients" })).toHaveAccessibleDescription("For four bowls.");
    expect(root.querySelector<HTMLElement>("[data-ouro-checklist-label]")!.getBoundingClientRect().width).toBeLessThanOrEqual(1);
  });

  it("keeps no header row when the label is hidden and nothing else would show there", async () => {
    const { root } = await render(<Checklist label="Ingredients" hideLabel items={ingredients} onCheckedChange={() => {}} />);
    await expect.element(page.getByRole("group", { name: "Ingredients" })).toBeVisible();
    // The hidden label is the group's first child, with the rows straight after it.
    expect(root.firstElementChild).toHaveAttribute("data-ouro-checklist-label");
    expect(root.firstElementChild!.nextElementSibling).toHaveAttribute("data-ouro-checklist-rows");
  });

  it("describes a row by its description and value", async () => {
    await render(<Host items={[{ id: "oats", label: "rolled oats", description: "or quick oats", value: "1 cup", checked: false }]} />);
    await expect.element(page.getByRole("checkbox", { name: "rolled oats" })).toHaveAccessibleDescription("or quick oats 1 cup");
  });

  it("forwards ref to the group and keeps layout classes", async () => {
    let element: HTMLDivElement | null = null;
    const { root } = await render(<Checklist label="Ingredients" items={ingredients} onCheckedChange={() => {}} className="mt-4" ref={(node) => void (element = node)} />);
    expect(element).toBe(root);
    expect(root.className).toContain("mt-4");
  });
});

describe("Checklist parts", () => {
  it("build a checklist row by row", async () => {
    const onCheckedChange = vi.fn();
    await render(
      <ChecklistRoot label="Steps" description="Tick them off as you go.">
        <ChecklistItem label="Preheat the oven" checked={false} onCheckedChange={onCheckedChange} value="5 min" action={<Button size="sm">Timer</Button>} />
        <ChecklistItem label="Whisk the eggs" description="Until pale" checked onCheckedChange={() => {}} disabled />
      </ChecklistRoot>,
    );
    await expect.element(page.getByRole("group", { name: "Steps" })).toHaveAccessibleDescription("Tick them off as you go.");
    await userEvent.click(page.getByText("5 min"));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    await expect.element(page.getByRole("checkbox", { name: "Whisk the eggs" })).toBeChecked();
    await expect.element(page.getByRole("checkbox", { name: "Whisk the eggs" })).toBeDisabled();
  });

  it("keep the header for actions beside a hidden label", async () => {
    const { root } = await render(
      <ChecklistRoot label="Steps" hideLabel actions={<Button size="sm">Reset</Button>}>
        <ChecklistItem label="Preheat the oven" checked={false} onCheckedChange={() => {}} />
      </ChecklistRoot>,
    );
    await expect.element(page.getByRole("group", { name: "Steps" })).toBeVisible();
    expect(root.firstElementChild!.querySelector("[data-ouro-checklist-label]")).toHaveClass("sr-only");
    expect(root.firstElementChild!.contains(page.getByRole("button", { name: "Reset" }).element())).toBe(true);
  });

  it("throw in development outside a ChecklistRoot, with the JSX they belong in", () => {
    expect(() => renderToString(<ChecklistItem label="Loose" checked={false} onCheckedChange={() => {}} />)).toThrow(
      '[ouro-ui] ChecklistItem: must be rendered inside <ChecklistRoot>. Fix: <ChecklistRoot label="…"><ChecklistItem label="…" checked={…} onCheckedChange={…} /></ChecklistRoot>.',
    );
  });
});

describe("Checklist development messages", () => {
  const messages = () => warn.mock.calls.map((call: unknown[]) => String(call[0]));
  const fixChange = "Fix: <Checklist onCheckedChange={(id, checked) => setChecked(id, checked)}>.";

  it("names the real prop for guessed ones", async () => {
    const guessed = { onChange: () => {}, isChecked: true, onToggle: () => {}, onCheck: () => {}, legend: "Ingredients" } as unknown as Partial<ChecklistProps>;
    await render(<Checklist label="Ingredients" items={ingredients} onCheckedChange={() => {}} {...guessed} />);
    await expect.poll(messages).toEqual([
      `[ouro-ui] Checklist: onChange is not a prop; onCheckedChange gets the row's id and its new state. ${fixChange}`,
      '[ouro-ui] Checklist: isChecked is not a prop; each item says whether it is checked. Fix: items={[{ id: "oats", label: "rolled oats", checked: true }]}.',
      `[ouro-ui] Checklist: onToggle is not a prop; onCheckedChange gets the row's id and its new state. ${fixChange}`,
      `[ouro-ui] Checklist: onCheck is not a prop; onCheckedChange gets the row's id and its new state. ${fixChange}`,
      '[ouro-ui] Checklist: legend is not a prop; a checklist is named by its label. Fix: <Checklist label="Ingredients">.',
    ]);
  });

  it("names a missing label, a repeated id and an appearance class", async () => {
    // React reports the repeated key itself.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const repeated = [ingredients[0]!, { ...ingredients[1]!, id: "oats" }];
    await render(<Checklist label="" items={repeated} onCheckedChange={() => {}} className="bg-red-500" />);
    await expect.poll(messages).toEqual(
      expect.arrayContaining([
        '[ouro-ui] Checklist: label is required; it names the group for screen readers. Fix: <Checklist label="Ingredients">.',
        '[ouro-ui] Checklist: two items share the id "oats"; each row needs its own. Fix: items={[{ id: "oats", … }, { id: "milk", … }]}.',
        expect.stringContaining('[ouro-ui] Checklist: "bg-red-500" sets appearance, and className is for layout only'),
      ]),
    );
  });

  it("has no messages for valid props", async () => {
    await render(<Host extra={{ description: "For four bowls.", empty: "Nothing yet." }} />);
    await act(async () => {});
    expect(messages()).toEqual([]);
  });
});

describe("Checklist on the server", () => {
  it("renders the rows, their state and the group's name in the server HTML", () => {
    const html = renderToString(<Checklist label="Ingredients" items={[{ ...ingredients[0]!, checked: true }, ingredients[1]!]} onCheckedChange={() => {}} />);
    expect(html).toContain('role="group"');
    expect(html).toContain("rolled oats");
    expect(html).toContain('aria-checked="true"');
    const parsed = document.createElement("div");
    parsed.innerHTML = html;
    expect(parsed.querySelectorAll('[data-ouro-part="row"]')).toHaveLength(2);
    expect(parsed.querySelectorAll('[data-ouro-part="row"][data-starting-style]')).toHaveLength(0);
  });

  it("hydrates with no hydration warning", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const node = <Checklist label="Ingredients" items={ingredients} onCheckedChange={() => {}} onClearChecked={() => {}} />;
    const host = document.createElement("div");
    host.innerHTML = renderToString(node);
    document.body.append(host);
    mounted.push(host);
    const recoverable: unknown[] = [];
    await act(async () => {
      roots.push(hydrateRoot(host, node, { onRecoverableError: (cause) => recoverable.push(cause) }));
    });
    expect(recoverable).toEqual([]);
    expect(error).not.toHaveBeenCalled();
  });
});
