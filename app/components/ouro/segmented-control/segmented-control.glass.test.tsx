import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { commands } from "vitest/browser";
import { SegmentedControl } from "~/components/ouro/segmented-control/segmented-control";
import { act } from "~/lib/ouro/testing/act";

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

const icon = <svg width="16" height="16" viewBox="0 0 16 16" />;

async function mount(glass = true) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <SegmentedControl
        label="View"
        hideLabel
        glass={glass}
        defaultValue="places"
        items={[
          { value: "places", label: "Places", icon, count: 14 },
          { value: "people", label: "People", icon, count: 3 },
        ]}
      />,
    ),
  );
  const group = host.querySelector<HTMLElement>('[role="radiogroup"]')!;
  return { group, segments: [...group.querySelectorAll<HTMLElement>('[role="radio"]')] };
}

describe("SegmentedControl glass", () => {
  it("keeps the label of a segment that has no icon, selected or not", async () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(<SegmentedControl label="View" hideLabel glass defaultValue="a" items={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} />),
    );
    const labels = [...host.querySelectorAll<HTMLElement>('[data-slot="segmented-control-label"]')];
    expect(labels.map((l) => l.classList.contains("sr-only"))).toEqual([false, false]);
    expect(host.querySelector('[data-slot="segmented-control-icon"]')).toBeNull();
  });

  it("marks the group with an empty data-glass, and fills its container with fullWidth", async () => {
    const { group } = await mount();
    expect(group.getAttribute("data-glass")).toBe("");
    await act(async () =>
      root!.render(<SegmentedControl label="View" hideLabel glass fullWidth items={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} />),
    );
    const wide = host!.querySelector<HTMLElement>('[role="radiogroup"]')!;
    expect(Math.round(wide.getBoundingClientRect().width)).toBe(Math.round(host!.getBoundingClientRect().width));
    expect(getComputedStyle(wide).display).toBe("grid");
  });

  it("is a 40px glass capsule with a rim and blur", async () => {
    const { group } = await mount();
    const style = getComputedStyle(group);
    expect(group.getBoundingClientRect().height).toBe(40);
    expect(parseFloat(style.borderTopLeftRadius)).toBeGreaterThanOrEqual(20);
    expect(parseFloat(style.borderTopWidth)).toBe(1);
    expect(style.backdropFilter).toContain("blur");
    expect(style.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(style.boxShadow).not.toBe("none");
  });

  it("shows the label and count of the checked segment only, and the icon of every segment", async () => {
    const { group, segments } = await mount();
    const [places, people] = segments as [HTMLElement, HTMLElement];
    expect(places.querySelectorAll('[data-slot="segmented-control-icon"]')).toHaveLength(1);
    expect(people.querySelectorAll('[data-slot="segmented-control-icon"]')).toHaveLength(1);
    expect(places.querySelector('[data-slot="segmented-control-count"]')?.textContent).toBe("14");
    expect(people.querySelector('[data-slot="segmented-control-count"]')).toBeNull();
    const labelOf = (segment: HTMLElement) => segment.querySelector<HTMLElement>('[data-slot="segmented-control-label"]')!;
    expect(labelOf(places).getBoundingClientRect().width).toBeGreaterThan(1);
    expect(labelOf(people).getBoundingClientRect().width).toBeLessThanOrEqual(1);
    expect(group.querySelectorAll('[role="radio"][aria-checked="true"]')).toHaveLength(1);
  });

  it("keeps an unchecked segment's lone icon in its middle, and spaces the checked one's icon from its label", async () => {
    const { segments } = await mount();
    const [places, people] = segments as [HTMLElement, HTMLElement];
    const iconOf = (segment: HTMLElement) => segment.querySelector<HTMLElement>('[data-slot="segmented-control-icon"]')!;
    expect(parseFloat(getComputedStyle(iconOf(places)).marginInlineEnd)).toBe(6);
    expect(parseFloat(getComputedStyle(iconOf(people)).marginInlineEnd)).toBe(0);
    expect(getComputedStyle(people.querySelector<HTMLElement>('[data-slot="segmented-control-label"]')!).position).toBe("absolute");
    const box = people.getBoundingClientRect();
    const ink = iconOf(people).getBoundingClientRect();
    expect(Math.abs((ink.left + ink.right) / 2 - (box.left + box.right) / 2)).toBeLessThanOrEqual(0.5);
  });

  it("draws the count as a 14px pill inside the segment", async () => {
    const { segments } = await mount();
    const segment = segments[0]!;
    const pill = segment.querySelector<HTMLElement>('[data-slot="segmented-control-count"]')!;
    const box = pill.getBoundingClientRect();
    const outer = segment.getBoundingClientRect();
    expect(box.height).toBe(14);
    expect(box.left).toBeGreaterThanOrEqual(outer.left);
    expect(box.right).toBeLessThanOrEqual(outer.right);
    expect(parseFloat(getComputedStyle(pill).borderTopLeftRadius)).toBeGreaterThanOrEqual(7);
    expect(parseFloat(getComputedStyle(pill).marginInlineStart)).toBe(6);
  });

  it("keeps every label and count, and the standard track, when glass is off", async () => {
    const { group, segments } = await mount(false);
    expect(group.getBoundingClientRect().height).not.toBe(40);
    expect(getComputedStyle(group).backdropFilter).toBe("none");
    expect(segments.every((segment) => segment.querySelector('[data-slot="segmented-control-count"]'))).toBe(true);
    expect(segments[1]!.querySelector<HTMLElement>('[data-slot="segmented-control-label"]')!.getBoundingClientRect().width).toBeGreaterThan(1);
  });

  it("is solid and unblurred under more contrast", async () => {
    await commands.emulateMedia({ contrast: "more" });
    try {
      const { group } = await mount();
      expect(getComputedStyle(group).backdropFilter).toBe("none");
      expect(getComputedStyle(group).backgroundColor).toMatch(/^rgb\(/);
    } finally {
      await commands.emulateMedia({ contrast: "no-preference" });
    }
  });
});
