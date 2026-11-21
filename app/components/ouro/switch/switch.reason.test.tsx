import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { Switch } from "~/components/ouro/switch/switch";
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

const control = () => document.querySelector<HTMLElement>('button[role="switch"]')!;
const tooltip = () => document.querySelector('[data-ouro="tooltip"]');

describe("Switch disabledReason", () => {
  it("Switch is aria-disabled, focusable and described by its reason", async () => {
    await render(<Switch label="Wi-Fi" disabledReason="Not yet" />);
    const el = control();
    expect(el.getAttribute("aria-disabled")).toBe("true");
    expect(el.hasAttribute("disabled")).toBe(false);
    expect(el.getAttribute("aria-describedby")!.split(" ").some((id) => document.getElementById(id)?.textContent === "Not yet")).toBe(true);
    await pressTab();
    expect(document.activeElement).toBe(el);
  });

  it("Switch ignores a click and Space while it has a reason", async () => {
    const onChange = vi.fn();
    await render(<Switch label="Wi-Fi" disabledReason="Not yet" onCheckedChange={onChange} />);
    const el = control();
    const before = el.getAttribute("aria-checked");
    el.click();
    await pressTab();
    await userEvent.keyboard(" ");
    expect(onChange).not.toHaveBeenCalled();
    expect(el.getAttribute("aria-checked")).toBe(before);
  });

  it("Switch shows its reason as a tooltip on focus and on hover", async () => {
    await render(<Switch label="Wi-Fi" disabledReason="Not yet" />);
    await pressTab();
    await expect.poll(() => tooltip()?.textContent).toBe("Not yet");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => tooltip()).toBeNull();
    await userEvent.unhover(control());
    await userEvent.hover(control());
    await expect.poll(() => tooltip()?.textContent).toBe("Not yet");
  });

  it("Switch stays enabled and shows no tooltip while the reason is undefined", async () => {
    const onChange = vi.fn();
    await render(<Switch label="Wi-Fi" disabledReason={undefined} onCheckedChange={onChange} />);
    expect(control().hasAttribute("aria-disabled")).toBe(false);
    await pressTab();
    await userEvent.keyboard(" ");
    expect(onChange).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(tooltip()).toBeNull();
  });
});
