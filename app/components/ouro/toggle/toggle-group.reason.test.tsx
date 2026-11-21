import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { ToggleGroup } from "~/components/ouro/toggle/toggle-group";
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

const control = () => document.querySelector<HTMLElement>('button[data-ouro-toggle]')!;
const tooltip = () => document.querySelector('[data-ouro="tooltip"]');

describe("ToggleGroup item disabledReason", () => {
  it("ToggleGroup item is aria-disabled, focusable and described by its reason", async () => {
    await render(<ToggleGroup label="Style" items={[{ value: "b", label: "Bold", disabledReason: "Not yet" }]} />);
    const el = control();
    expect(el.getAttribute("aria-disabled")).toBe("true");
    expect(el.hasAttribute("disabled")).toBe(false);
    expect(el.getAttribute("aria-describedby")!.split(" ").some((id) => document.getElementById(id)?.textContent === "Not yet")).toBe(true);
    await pressTab();
    expect(document.activeElement).toBe(el);
  });

  it("ToggleGroup item ignores a click and Space while it has a reason", async () => {
    const onChange = vi.fn();
    await render(<ToggleGroup label="Style" onValueChange={onChange} items={[{ value: "b", label: "Bold", disabledReason: "Not yet" }]} />);
    const el = control();
    const before = el.getAttribute("aria-pressed");
    el.click();
    await pressTab();
    await userEvent.keyboard(" ");
    expect(onChange).not.toHaveBeenCalled();
    expect(el.getAttribute("aria-pressed")).toBe(before);
  });

  it("ToggleGroup item shows its reason as a tooltip on focus and on hover", async () => {
    await render(<ToggleGroup label="Style" items={[{ value: "b", label: "Bold", disabledReason: "Not yet" }]} />);
    await pressTab();
    await expect.poll(() => tooltip()?.textContent).toBe("Not yet");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => tooltip()).toBeNull();
    await userEvent.unhover(control());
    await userEvent.hover(control());
    await expect.poll(() => tooltip()?.textContent).toBe("Not yet");
  });

  it("ToggleGroup item stays enabled and shows no tooltip while the reason is undefined", async () => {
    const onChange = vi.fn();
    await render(<ToggleGroup label="Style" onValueChange={onChange} items={[{ value: "b", label: "Bold", disabledReason: undefined }]} />);
    expect(control().hasAttribute("aria-disabled")).toBe(false);
    await pressTab();
    await userEvent.keyboard(" ");
    expect(onChange).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(tooltip()).toBeNull();
  });
});
