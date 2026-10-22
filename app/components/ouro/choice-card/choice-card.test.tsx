import { type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { ChoiceCard, type ChoiceCardItem } from "~/components/ouro/choice-card/choice-card";
import { act } from "~/lib/ouro/testing/act";
import { expectMotion, expectNoMotion, parseDuration } from "~/lib/ouro/testing/motion";
import { pressTab } from "~/lib/ouro/testing/tab";

const roots: Root[] = [];
let mounted: Element[] = [];

const pixel = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='30'/%3E";
const items: ChoiceCardItem[] = [
  { value: "dawn", label: "Dawn", description: "Soft light", media: <img src={pixel} alt="" /> },
  { value: "noon", label: "Noon", media: <img src={pixel} alt="" /> },
  { value: "dusk", label: "Dusk", description: "Long shadows" },
];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    root,
    group: () => host.querySelector<HTMLFieldSetElement>('[data-ouro="choice-card"]')!,
    cards: () => [...host.querySelectorAll<HTMLElement>('[data-ouro-part="card"]')],
    inputs: () => [...host.querySelectorAll<HTMLInputElement>('[data-ouro-part="input"]')],
  };
}

const token = (name: string) => parseDuration(getComputedStyle(document.documentElement).getPropertyValue(name));
const probe = (property: "color" | "borderColor", value: string) => {
  const element = document.createElement("span");
  element.style[property] = value;
  document.body.append(element);
  mounted.push(element);
  return property === "color" ? getComputedStyle(element).color : getComputedStyle(element).borderTopColor;
};

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
  await commands.emulateMedia({ reducedMotion: "no-preference" });
  await page.viewport(414, 896);
});

describe("ChoiceCard", () => {
  it("is a group named by its legend, of radios named by their labels and described by their descriptions", async () => {
    await render(<ChoiceCard legend="Cover photo" description="Shown on the card." items={items} />);
    await expect.element(page.getByRole("group", { name: "Cover photo" })).toBeVisible();
    await expect.element(page.getByRole("radio", { name: "Dawn" })).toHaveAccessibleDescription("Soft light");
    await expect.element(page.getByRole("radio", { name: "Noon" })).not.toHaveAttribute("aria-describedby");
    await expect.element(page.getByRole("group", { name: "Cover photo" })).toHaveAccessibleDescription("Shown on the card.");
  });

  it("chooses a card on a click, marks it with the primary border, and reports the value", async () => {
    const onValueChange = vi.fn();
    const { cards, inputs } = await render(<ChoiceCard legend="Cover" items={items} onValueChange={onValueChange} />);
    await userEvent.click(cards()[1]!);
    expect(inputs()[1]!.checked).toBe(true);
    expect(cards()[1]!.hasAttribute("data-checked")).toBe(true);
    expect(cards()[0]!.hasAttribute("data-checked")).toBe(false);
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith("noon");
    await expect.poll(() => getComputedStyle(cards()[1]!).borderTopColor).toBe(probe("borderColor", "var(--primary)"));
  });

  it("colours the chosen card's border and surface, with reduced motion too", async () => {
    const { root, cards } = await render(<ChoiceCard legend="Cover" items={items} value="dawn" />);
    for (const reduced of [false, true]) {
      await commands.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      const next = reduced ? "dusk" : "noon";
      // The browser starts a transition only from a style it has already computed.
      for (const card of cards()) void getComputedStyle(card).borderTopColor;
      flushSync(() => root.render(<ChoiceCard legend="Cover" items={items} value={next} />));
      const card = cards()[reduced ? 2 : 1]!;
      await expectMotion(card, {
        stem: "choice-card",
        state: "data-checked",
        properties: { "background-color": token("--ouro-duration-fast"), "border-color": token("--ouro-duration-fast") },
        reduced,
      });
    }
  });

  it("turns the cards' borders red when an error arrives, with reduced motion too", async () => {
    const { root, cards } = await render(<ChoiceCard legend="Cover" items={items} />);
    for (const reduced of [false, true]) {
      await commands.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      void getComputedStyle(cards()[0]!).borderTopColor;
      flushSync(() => root.render(<ChoiceCard legend="Cover" items={items} error="Choose one." />));
      await expectMotion(cards()[0]!, { stem: "choice-card", state: "data-invalid", properties: { "border-color": token("--ouro-duration-fast") }, reduced });
      await act(async () => root.render(<ChoiceCard legend="Cover" items={items} />));
      await expect.poll(() => cards()[0]!.getAnimations().length).toBe(0);
    }
  });

  it("does not move when it becomes disabled", async () => {
    const { root, cards } = await render(<ChoiceCard legend="Cover" items={items} />);
    void getComputedStyle(cards()[0]!).opacity;
    flushSync(() => root.render(<ChoiceCard legend="Cover" items={items} disabled />));
    await expectNoMotion(cards()[0]!, { stem: "choice-card", state: "data-disabled", reduced: false });
  });

  it("moves between cards with the arrow keys, as a radio group does", async () => {
    const { inputs } = await render(
      <>
        <button type="button">Before</button>
        <ChoiceCard legend="Cover" items={items} defaultValue="dawn" />
      </>,
    );
    page.getByRole("button", { name: "Before" }).element().focus();
    await pressTab();
    expect(document.activeElement).toBe(inputs()[0]);
    await userEvent.keyboard("{ArrowRight}");
    expect(inputs()[1]!.checked).toBe(true);
    expect(document.activeElement).toBe(inputs()[1]);
  });

  it("follows a controlled value", async () => {
    const { root, inputs } = await render(<ChoiceCard legend="Cover" items={items} value="noon" />);
    expect(inputs()[1]!.checked).toBe(true);
    await act(async () => root.render(<ChoiceCard legend="Cover" items={items} value="dusk" />));
    expect(inputs()[2]!.checked).toBe(true);
    expect(inputs()[1]!.checked).toBe(false);
  });

  it("submits the chosen value under its name", async () => {
    const { host } = await render(
      <form>
        <ChoiceCard legend="Cover" name="cover" items={items} defaultValue="dusk" />
      </form>,
    );
    expect(new FormData(host.querySelector("form")!).get("cover")).toBe("dusk");
  });

  it("shows an error under the cards, read with each choice, and marks them invalid", async () => {
    const { group, inputs, cards } = await render(<ChoiceCard legend="Cover" items={items} error="Choose a cover." required />);
    await expect.element(page.getByRole("radio", { name: "Noon" })).toHaveAccessibleDescription("Choose a cover.");
    await expect.element(page.getByRole("radio", { name: "Dawn" })).toHaveAccessibleDescription("Soft light Choose a cover.");
    expect(inputs().every((input) => input.getAttribute("aria-invalid") === "true" && input.required)).toBe(true);
    expect(getComputedStyle(cards()[0]!).borderTopColor).toBe(probe("borderColor", "var(--destructive)"));
    const legend = group().querySelector("legend")!;
    expect(getComputedStyle(legend, "::after").content).toContain("*");
    await expect.element(page.getByRole("group", { name: "Cover" })).toBeVisible();
    expect(group().getAttribute("aria-describedby")).toMatch(/-error$/);
  });

  it("disables every card, or one", async () => {
    const { root, inputs, cards } = await render(<ChoiceCard legend="Cover" items={items} disabled />);
    expect(inputs().every((input) => input.disabled)).toBe(true);
    expect(cards().every((card) => card.hasAttribute("data-disabled"))).toBe(true);
    await act(async () => root.render(<ChoiceCard legend="Cover" items={[...items.slice(0, 2), { ...items[2]!, disabled: true }]} />));
    expect(inputs().map((input) => input.disabled)).toEqual([false, false, true]);
  });

  it("keeps the legend for screen readers only with hideLegend", async () => {
    const { group } = await render(<ChoiceCard legend="Cover" items={items} hideLegend />);
    expect(group().querySelector("legend")!.getBoundingClientRect().width).toBeLessThanOrEqual(1);
    await expect.element(page.getByRole("group", { name: "Cover" })).toBeInTheDocument();
  });

  it.each([
    [2, 2, 1],
    [3, 3, 2],
    [4, 4, 2],
  ] as const)("puts %s cards in a row on a wide screen and fewer on a phone", async (columns, wide, phone) => {
    const many = Array.from({ length: 4 }, (_, index) => ({ value: String(index), label: `Choice ${index}` }));
    await page.viewport(1024, 768);
    const { cards } = await render(<ChoiceCard legend="Cover" items={many} columns={columns} />);
    const rowOf = () => new Set(cards().map((card) => Math.round(card.getBoundingClientRect().top))).size;
    expect(rowOf()).toBe(Math.ceil(4 / wide));
    await page.viewport(390, 844);
    await expect.poll(rowOf).toBe(Math.ceil(4 / phone));
  });

  it("forwards a ref and lets layout classes win, with no margin of its own", async () => {
    let element: HTMLFieldSetElement | null = null;
    const { group } = await render(<ChoiceCard legend="Cover" items={items} className="mt-6" ref={(node) => void (element = node)} />);
    expect(element).toBe(group());
    expect(getComputedStyle(group()).marginTop).toBe("24px");
    expect(getComputedStyle(group()).marginBottom).toBe("0px");
  });
});

describe("ChoiceCard development messages", () => {
  it.each([
    ["columns", { columns: 5 }, "columns={5} is not a column count; use 2, 3 or 4", "<ChoiceCard columns={3} />"],
    ["options", { options: [] }, "options is not a prop", "<ChoiceCard items={[{ value, label, media }]} />"],
    ["label", { label: "Cover" }, "label is not a prop; the group's name is legend", '<ChoiceCard legend="Cover" />'],
    ["label", { label: 1 }, "label is not a prop; the group's name is legend", '<ChoiceCard legend="Cover photo" />'],
    ["onChange", { onChange: () => {} }, "onChange is not a prop", "<ChoiceCard onValueChange={setValue} />"],
    ["items", { items: [items[0], items[0]] }, "two items share a value, so they choose together", "<ChoiceCard items={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />"],
  ])("explains %s with the fix", async (_name, extra, problem, fix) => {
    const props = { legend: "L", items, ...extra } as unknown as Parameters<typeof ChoiceCard>[0];
    const { group } = await render(<ChoiceCard {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] ChoiceCard: ${problem}. Fix: ${fix}.`);
    expect(group().hasAttribute("options")).toBe(false);
    expect(group().hasAttribute("label")).toBe(false);
  });

  it.each([
    ["bg-muted", 'remove "bg-muted"; ChoiceCard sets its own look from the theme'],
    ["max-w-xl", ""],
  ])("checks the className %s", async (className, fix) => {
    await render(<ChoiceCard legend="L" items={items} className={className} />);
    if (fix) expect(warn).toHaveBeenCalledWith(`[ouro-ui] ChoiceCard: "${className}" sets appearance, and className is for layout only. Fix: ${fix}.`);
    else expect(warn).not.toHaveBeenCalled();
  });

  it("renders to a string with the default value chosen", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(<ChoiceCard legend="Cover" name="cover" items={items} defaultValue="noon" />);
    expect(html).toContain('data-ouro="choice-card"');
    expect(html).toMatch(/value="noon"[^>]*checked|checked[^>]*value="noon"/);
    expect(error).not.toHaveBeenCalled();
  });
});
