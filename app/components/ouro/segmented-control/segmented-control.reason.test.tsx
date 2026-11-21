import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { SegmentedControl } from "~/components/ouro/segmented-control/segmented-control";
import { act } from "~/lib/ouro/testing/act";
import { pressTab } from "~/lib/ouro/testing/tab";

const roots: Root[] = [];
const hosts: Element[] = [];

async function render(node: React.ReactNode) {
  const host = document.createElement("div");
  host.style.padding = "80px";
  document.body.append(host);
  hosts.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return host;
}

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  hosts.splice(0).forEach((host) => host.remove());
});

const segments = () => Array.from(document.querySelectorAll<HTMLElement>('[role="radio"]'));
const tooltip = () => document.querySelector('[data-ouro="tooltip"]');
const items = [
  { value: "list", label: "List" },
  { value: "map", label: "Map", disabledReason: "Maps need a connection" },
  { value: "grid", label: "Grid" },
];

describe("SegmentedControl segment looks off with a reason", () => {
  it("dims a segment off with a reason as a disabled one is, and leaves the others on", async () => {
    await render(
      <SegmentedControl
        label="View"
        items={[
          { value: "list", label: "List" },
          { value: "map", label: "Map", disabledReason: "Maps need a connection" },
          { value: "grid", label: "Grid", disabled: true },
        ]}
      />,
    );
    const [on, reasoned, disabled] = segments();
    expect(getComputedStyle(disabled!).opacity).toBe("0.5");
    expect(getComputedStyle(reasoned!).opacity).toBe("0.5");
    expect(getComputedStyle(reasoned!).cursor).toBe("not-allowed");
    expect(reasoned!.getAttribute("data-disabled")).toBe("");
    expect(on!.hasAttribute("data-disabled")).toBe(false);
    expect(getComputedStyle(on!).opacity).toBe("1");
  });
});

describe("SegmentedControl item disabledReason", () => {
  it("turns a segment off with aria-disabled, keeps it focusable and describes it by the reason", async () => {
    await render(<SegmentedControl label="View" items={items} />);
    const el = segments()[1]!;
    expect(el.getAttribute("aria-disabled")).toBe("true");
    expect(el.hasAttribute("disabled")).toBe(false);
    expect(document.getElementById(el.getAttribute("aria-describedby")!)!.textContent).toBe("Maps need a connection");
    el.focus();
    expect(document.activeElement).toBe(el);
  });

  it("is never checked by pointer or keyboard, and the arrow keys land on it and move on", async () => {
    const onValueChange = vi.fn();
    await render(<SegmentedControl label="View" items={items} defaultValue="list" onValueChange={onValueChange} />);
    segments()[1]!.click();
    expect(onValueChange).not.toHaveBeenCalled();
    await pressTab();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(segments()[1]);
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{Enter}");
    expect(onValueChange).not.toHaveBeenCalled();
    expect(segments()[0]!.getAttribute("aria-checked")).toBe("true");
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(segments()[2]);
    expect(onValueChange).toHaveBeenCalledWith("grid");
  });

  it("shows the reason as its tooltip on keyboard focus and on hover", async () => {
    await render(<SegmentedControl label="View" items={items} />);
    await pressTab();
    await userEvent.keyboard("{ArrowRight}");
    await expect.poll(() => tooltip()?.textContent).toBe("Maps need a connection");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => tooltip()).toBeNull();
    await userEvent.unhover(segments()[1]!);
    await userEvent.hover(segments()[1]!);
    await expect.poll(() => tooltip()?.textContent).toBe("Maps need a connection");
  });

  it("lets the reason win over disabled on an item", async () => {
    await render(<SegmentedControl label="View" items={[{ value: "a", label: "A" }, { value: "b", label: "B", disabled: true, disabledReason: "Why" }]} />);
    expect(segments()[1]!.getAttribute("aria-disabled")).toBe("true");
    expect(segments()[1]!.hasAttribute("disabled")).toBe(false);
  });

  it("leaves a segment a plain one while the reason is undefined, and shows no tooltip", async () => {
    const onValueChange = vi.fn();
    await render(<SegmentedControl label="View" onValueChange={onValueChange} items={[{ value: "a", label: "A" }, { value: "b", label: "B", disabledReason: undefined }]} />);
    expect(segments()[1]!.hasAttribute("aria-disabled")).toBe(false);
    expect(segments()[1]!.hasAttribute("aria-describedby")).toBe(false);
    segments()[1]!.click();
    expect(onValueChange).toHaveBeenCalledWith("b");
    await userEvent.hover(segments()[1]!);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(tooltip()).toBeNull();
  });
});
