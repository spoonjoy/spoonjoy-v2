import { createRef, useState, type ReactNode, type SVGProps } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { ToggleGroup, type ToggleGroupProps } from "~/components/ouro/toggle/toggle-group";
import { act } from "~/lib/ouro/testing/act";
import { pressTab } from "~/lib/ouro/testing/tab";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.padding = "24px";
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    rerender: (next: ReactNode) => act(async () => root.render(next)),
    get root() {
      return host.querySelector<HTMLElement>('[data-ouro="toggle-group"]')!;
    },
    get group() {
      return host.querySelector<HTMLElement>('[role="group"]')!;
    },
    get toggles() {
      return [...host.querySelectorAll<HTMLButtonElement>("button")];
    },
  };
}

const pressed = (toggles: HTMLButtonElement[]) => toggles.map((toggle) => toggle.getAttribute("aria-pressed") === "true");

function Icon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 16 16" {...props} />;
}

const styles = [
  { value: "bold", label: "Bold", icon: Icon },
  { value: "italic", label: "Italic", icon: Icon },
  { value: "underline", label: "Underline", icon: Icon },
];
const align = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
  await page.viewport(414, 896);
});

describe("ToggleGroup", () => {
  it("is a labeled group of toggle buttons", async () => {
    const { root, group, toggles } = await render(<ToggleGroup label="Alignment" items={align} />);
    expect(root.getAttribute("data-ouro")).toBe("toggle-group");
    expect(group.getAttribute("aria-labelledby")).toBe(root.querySelector("span")!.id);
    await expect.element(page.getByRole("group", { name: "Alignment" })).toBeVisible();
    expect(toggles.map((toggle) => toggle.textContent)).toEqual(["Left", "Center", "Right"]);
    expect(pressed(toggles)).toEqual([false, false, false]);
    expect(toggles.every((toggle) => toggle.type === "button")).toBe(true);
  });

  it("names each toggle's variant in data-variant", async () => {
    const { toggles } = await render(<ToggleGroup label="Alignment" items={align} variant="outline" />);
    expect(toggles.map((toggle) => toggle.getAttribute("data-variant"))).toEqual(["outline", "outline", "outline"]);
  });

  it("presses one item at a time and reports the value, or null when none is pressed", async () => {
    const onValueChange = vi.fn();
    const { toggles } = await render(<ToggleGroup label="Alignment" items={align} defaultValue="left" onValueChange={onValueChange} />);
    expect(pressed(toggles)).toEqual([true, false, false]);
    await userEvent.click(toggles[2]!);
    expect(pressed(toggles)).toEqual([false, false, true]);
    expect(onValueChange).toHaveBeenLastCalledWith("right");
    await userEvent.click(toggles[2]!);
    expect(pressed(toggles)).toEqual([false, false, false]);
    expect(onValueChange).toHaveBeenLastCalledWith(null);
  });

  it("presses several items with multiple and reports the list", async () => {
    const onValueChange = vi.fn();
    const { toggles } = await render(
      <ToggleGroup label="Text style" multiple items={styles} defaultValue={["bold"]} onValueChange={onValueChange} />,
    );
    expect(pressed(toggles)).toEqual([true, false, false]);
    await userEvent.click(toggles[1]!);
    expect(pressed(toggles)).toEqual([true, true, false]);
    expect(onValueChange).toHaveBeenLastCalledWith(["bold", "italic"]);
    await userEvent.click(toggles[0]!);
    expect(onValueChange).toHaveBeenLastCalledWith(["italic"]);
  });

  it("follows a controlled value in both modes", async () => {
    function Controlled() {
      const [one, setOne] = useState<string | null>(null);
      const [many, setMany] = useState<string[]>([]);
      return (
        <>
          <ToggleGroup label="Alignment" items={align} value={one} onValueChange={setOne} />
          <ToggleGroup label="Text style" multiple items={styles} value={many} onValueChange={setMany} />
          <output>{`${one}|${many.join(",")}`}</output>
        </>
      );
    }
    const { host, toggles } = await render(<Controlled />);
    expect(pressed(toggles)).toEqual([false, false, false, false, false, false]);
    await userEvent.click(toggles[0]!);
    await userEvent.click(toggles[5]!);
    expect(pressed(toggles)).toEqual([true, false, false, false, false, true]);
    expect(host.querySelector("output")!.textContent).toBe("left|underline");
  });

  it("moves focus with the arrow keys and presses with Space", async () => {
    const { toggles } = await render(<ToggleGroup label="Alignment" items={align} />);
    document.body.focus();
    await pressTab();
    expect(document.activeElement).toBe(toggles[0]);
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(toggles[1]);
    await userEvent.keyboard(" ");
    expect(pressed(toggles)).toEqual([false, true, false]);
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(document.activeElement).toBe(toggles[2]);
  });

  it("shows only the icons for items with hideLabel, keeping the labels as names", async () => {
    const items = styles.map((item) => ({ ...item, hideLabel: true }));
    const { toggles } = await render(<ToggleGroup label="Text style" multiple items={items} />);
    expect(toggles.map((toggle) => toggle.getAttribute("aria-label"))).toEqual(["Bold", "Italic", "Underline"]);
    expect(toggles.every((toggle) => toggle.textContent === "")).toBe(true);
    await expect.element(page.getByRole("button", { name: "Italic" })).toBeVisible();
  });

  it("hides the group label visually with hideLabel and keeps it as the name", async () => {
    const { root } = await render(<ToggleGroup label="Alignment" hideLabel items={align} />);
    expect(root.querySelector("span")!.className).toContain("sr-only");
    await expect.element(page.getByRole("group", { name: "Alignment" })).toBeInTheDocument();
  });

  it("disables one item, or the whole group", async () => {
    const items = [...align.slice(0, 2), { ...align[2]!, disabled: true }];
    const { toggles, rerender } = await render(<ToggleGroup label="Alignment" items={items} />);
    expect(toggles.map((toggle) => toggle.disabled)).toEqual([false, false, true]);
    await rerender(<ToggleGroup label="Alignment" items={align} disabled />);
    expect(toggles.map((toggle) => toggle.disabled)).toEqual([true, true, true]);
  });

  it("passes variant and size to every item", async () => {
    await page.viewport(390, 844);
    const { toggles } = await render(<ToggleGroup label="Alignment" items={align} variant="outline" size="sm" />);
    for (const toggle of toggles) {
      expect(getComputedStyle(toggle).borderTopColor).not.toBe("rgba(0, 0, 0, 0)");
      expect(toggle.getBoundingClientRect().height).toBe(36);
    }
  });

  it("forwards its ref to the group and lets layout classes win on the root", async () => {
    const ref = createRef<HTMLDivElement>();
    const { group, root } = await render(<ToggleGroup label="Alignment" items={align} ref={ref} className="mt-6" />);
    expect(ref.current).toBe(group);
    expect(getComputedStyle(root).marginTop).toBe("24px");
  });
});

describe("ToggleGroup development messages", () => {
  it.each([
    ["options", { options: align }, "options is not a prop", '<ToggleGroup items={[{ value, label }]}>'],
    ["type", { type: "multiple" }, 'type="multiple" is not a prop', "<ToggleGroup multiple>"],
    ["onChange", { onChange: () => {} }, "onChange is not a prop", "<ToggleGroup onValueChange={(value) => …}>"],
    ["children", { children: "x" }, "children is not a prop; the toggles come from items", '<ToggleGroup items={[{ value: "bold", label: "Bold" }]}>'],
  ])("warns for %s with the fix", async (name, extra, problem, fix) => {
    const props = { label: "Alignment", items: align, ...extra } as unknown as ToggleGroupProps;
    const { host } = await render(<ToggleGroup {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] ToggleGroup: ${problem}. Fix: ${fix}.`);
    // Guard props never reach the DOM (the toggles' own type is "button").
    for (const element of host.querySelectorAll(":not(button)")) expect(element.hasAttribute(name.toLowerCase())).toBe(false);
  });

  it("names the single-choice fix for type=single", async () => {
    const props = { label: "Alignment", items: align, type: "single" } as unknown as ToggleGroupProps;
    await render(<ToggleGroup {...props} />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] ToggleGroup: type="single" is not a prop. Fix: <ToggleGroup> (one at a time is the default).');
  });

  it("warns for a value that matches no item, and for a list without multiple", async () => {
    const props = { label: "Alignment", items: align, defaultValue: ["left"] } as unknown as ToggleGroupProps;
    // Each case is its own group: one group going from defaultValue to value would make Base UI
    // log that it changed from uncontrolled to controlled.
    await render(<ToggleGroup {...props} />);
    expect(warn).toHaveBeenCalledWith("[ouro-ui] ToggleGroup: a list of values needs multiple. Fix: <ToggleGroup multiple defaultValue={[…]}>.");
    await render(<ToggleGroup label="Alignment" items={align} value="top" />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] ToggleGroup: value "top" matches no item. Fix: <ToggleGroup value="left">.');
    const many = { label: "Style", items: styles, multiple: true, value: "bold" } as unknown as ToggleGroupProps;
    await render(<ToggleGroup {...many} />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] ToggleGroup: multiple takes a list of values. Fix: <ToggleGroup multiple value={["bold"]}>.');
  });

  it("names a placeholder value in the fix when there are no items", async () => {
    const props = { label: "Style", items: [], multiple: true, value: "x" } as unknown as ToggleGroupProps;
    await render(<ToggleGroup {...props} />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] ToggleGroup: multiple takes a list of values. Fix: <ToggleGroup multiple value={["bold"]}>.');
  });

  it("warns for an item with hideLabel and no icon", async () => {
    await render(<ToggleGroup label="Alignment" items={[{ value: "left", label: "Left", hideLabel: true }]} />);
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] ToggleGroup: item "left" hides its label without an icon. Fix: { value: "left", label: "Left", icon: LeftIcon, hideLabel: true }.',
    );
  });

  it("throws for two items with the same value", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderToString(<ToggleGroup label="Alignment" items={[align[0]!, align[0]!]} />)).toThrow(
      '[ouro-ui] ToggleGroup: two items have the value "left". Fix: give each item its own value.',
    );
    error.mockRestore();
  });

  it("warns for an unknown variant or size and renders the default", async () => {
    const props = { label: "Alignment", items: align, variant: "default", size: "lg2" } as unknown as ToggleGroupProps;
    const { toggles } = await render(<ToggleGroup {...props} />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] ToggleGroup: variant="default" is not a variant. Fix: <ToggleGroup>.');
    expect(warn).toHaveBeenCalledWith('[ouro-ui] ToggleGroup: size="lg2" is not a size. Fix: <ToggleGroup size="md">.');
    expect(toggles[0]!.className).toContain("border-transparent");
  });

  it("warns for appearance classes and an empty label", async () => {
    await render(<ToggleGroup label="" items={align} className="rounded-xl" />);
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] ToggleGroup: "rounded-xl" sets appearance, and className is for layout only. Fix: :root { --radius: 0.75rem }.',
    );
    expect(warn).toHaveBeenCalledWith('[ouro-ui] ToggleGroup: label is empty, so the group has no name. Fix: <ToggleGroup label="Text style" hideLabel>.');
  });

  it("says nothing for a full, valid group", async () => {
    await render(
      <>
        <ToggleGroup label="Alignment" hideLabel items={align} defaultValue="left" variant="outline" size="lg" className="mt-2" />
        <ToggleGroup label="Text style" multiple items={styles.map((item) => ({ ...item, hideLabel: true }))} value={["bold"]} />
      </>,
    );
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("ToggleGroup server rendering", () => {
  const node = <ToggleGroup label="Alignment" items={align} defaultValue="center" />;

  it("renders the group name and pressed state on the server, and hydrates with no warning", async () => {
    const html = renderToString(node);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const group = doc.querySelector('[role="group"]')!;
    expect(doc.getElementById(group.getAttribute("aria-labelledby")!)!.textContent).toBe("Alignment");
    expect([...doc.querySelectorAll("button")].map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);

    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    mounted.push(host);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const recoverable = vi.fn();
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(host, node, { onRecoverableError: recoverable });
    });
    roots.push(root);
    expect(recoverable).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    await userEvent.click(host.querySelector("button")!);
    expect(host.querySelector("button")!.getAttribute("aria-pressed")).toBe("true");
  });
});
