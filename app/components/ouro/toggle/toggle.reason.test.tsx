import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { Toggle } from "~/components/ouro/toggle/toggle";
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

const control = () => document.querySelector<HTMLElement>('button[data-ouro="toggle"]')!;
const tooltip = () => document.querySelector('[data-ouro="tooltip"]');

describe("Toggle disabledReason", () => {
  it("Toggle is aria-disabled, focusable and described by its reason", async () => {
    await render(<Toggle label="Bold" disabledReason="Not yet" />);
    const el = control();
    expect(el.getAttribute("aria-disabled")).toBe("true");
    expect(el.hasAttribute("disabled")).toBe(false);
    expect(el.getAttribute("aria-describedby")!.split(" ").some((id) => document.getElementById(id)?.textContent === "Not yet")).toBe(true);
    await pressTab();
    expect(document.activeElement).toBe(el);
  });

  it("Toggle ignores a click and Space while it has a reason", async () => {
    const onChange = vi.fn();
    await render(<Toggle label="Bold" disabledReason="Not yet" onPressedChange={onChange} />);
    const el = control();
    const before = el.getAttribute("aria-pressed");
    el.click();
    await pressTab();
    await userEvent.keyboard(" ");
    expect(onChange).not.toHaveBeenCalled();
    expect(el.getAttribute("aria-pressed")).toBe(before);
  });

  it("Toggle shows its reason as a tooltip on focus and on hover", async () => {
    await render(<Toggle label="Bold" disabledReason="Not yet" />);
    await pressTab();
    await expect.poll(() => tooltip()?.textContent).toBe("Not yet");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => tooltip()).toBeNull();
    await userEvent.unhover(control());
    await userEvent.hover(control());
    await expect.poll(() => tooltip()?.textContent).toBe("Not yet");
  });

  it("Toggle stays enabled and shows no tooltip while the reason is undefined", async () => {
    const onChange = vi.fn();
    await render(<Toggle label="Bold" disabledReason={undefined} onPressedChange={onChange} />);
    expect(control().hasAttribute("aria-disabled")).toBe(false);
    await pressTab();
    await userEvent.keyboard(" ");
    expect(onChange).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(tooltip()).toBeNull();
  });

  it("Toggle lets the reason win over disabled and keeps its pressed state as the reason comes and goes", async () => {
    function Demo() {
      const [off, setOff] = useState(false);
      return <Toggle label="Bold" defaultPressed disabled disabledReason={off ? "Locked" : undefined} onPressedChange={() => setOff(true)} />;
    }
    await render(<Demo />);
    // disabled with an undefined reason is plain disabled: not focusable
    expect(control().hasAttribute("disabled")).toBe(true);
    await render(<Toggle label="Italic" defaultPressed disabled disabledReason="Locked" />);
    const soft = document.querySelectorAll<HTMLElement>('button[data-ouro="toggle"]')[1]!;
    expect(soft.getAttribute("aria-disabled")).toBe("true");
    expect(soft.getAttribute("aria-pressed")).toBe("true");
  });

  it("Toggle with a reason key presses on its own when no handler is passed, and follows pressed when it is controlled", async () => {
    await render(<Toggle label="Bold" disabledReason={undefined} />);
    control().click();
    await expect.poll(() => control().getAttribute("aria-pressed")).toBe("true");
    const onChange = vi.fn();
    await render(<Toggle label="Italic" pressed={false} disabledReason={undefined} onPressedChange={onChange} />);
    const held = document.querySelectorAll<HTMLElement>('button[data-ouro="toggle"]')[1]!;
    held.click();
    expect(onChange).toHaveBeenCalledWith(true);
    expect(held.getAttribute("aria-pressed")).toBe("false");
  });
});
