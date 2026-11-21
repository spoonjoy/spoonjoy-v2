import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { Checkbox } from "~/components/ouro/checkbox/checkbox";
import { CheckboxGroup } from "~/components/ouro/checkbox/checkbox-group";
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

const control = () => document.querySelector<HTMLElement>('button[role="checkbox"]')!;
const tooltip = () => document.querySelector('[data-ouro="tooltip"]');

describe("Checkbox disabledReason", () => {
  it("Checkbox is aria-disabled, focusable and described by its reason", async () => {
    await render(<Checkbox label="Basil" disabledReason="Not yet" />);
    const el = control();
    expect(el.getAttribute("aria-disabled")).toBe("true");
    expect(el.hasAttribute("disabled")).toBe(false);
    expect(el.getAttribute("data-disabled")).toBe("");
    expect(el.getAttribute("aria-describedby")!.split(" ").some((id) => document.getElementById(id)?.textContent === "Not yet")).toBe(true);
    await pressTab();
    expect(document.activeElement).toBe(el);
  });

  it("Checkbox keeps a reason soft when disabled is passed too, and a read-only box stays read-only without one", async () => {
    await render(<Checkbox label="Basil" disabled disabledReason="Not yet" />);
    expect(control().hasAttribute("disabled")).toBe(false);
    expect(control().getAttribute("aria-disabled")).toBe("true");
    await render(<Checkbox label="Mint" readOnly />);
    const mint = document.querySelectorAll<HTMLElement>('button[role="checkbox"]')[1]!;
    expect(mint.getAttribute("aria-readonly")).toBe("true");
    expect(mint.hasAttribute("aria-disabled")).toBe(false);
  });

  it("Checkbox with a value and a reason works inside a CheckboxGroup", async () => {
    await render(
      <CheckboxGroup legend="Herbs">
        <Checkbox label="Basil" value="basil" disabledReason="Not yet" />
      </CheckboxGroup>,
    );
    expect(control().getAttribute("aria-disabled")).toBe("true");
  });

  it("Checkbox in a CheckboxGroup without a value names the fix", async () => {
    const note = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await render(
        <CheckboxGroup legend="Herbs">
          <Checkbox label="Basil" disabledReason="Not yet" />
        </CheckboxGroup>,
      );
      expect(note.mock.calls.map((c) => String(c[0])).join("\n")).toContain("needs a value");
    } finally {
      note.mockRestore();
    }
  });

  it("Checkbox ignores a click and Space while it has a reason", async () => {
    const onChange = vi.fn();
    await render(<Checkbox label="Basil" disabledReason="Not yet" onCheckedChange={onChange} />);
    const el = control();
    const before = el.getAttribute("aria-checked");
    el.click();
    await pressTab();
    await userEvent.keyboard(" ");
    expect(onChange).not.toHaveBeenCalled();
    expect(el.getAttribute("aria-checked")).toBe(before);
  });

  it("Checkbox shows its reason as a tooltip on focus and on hover", async () => {
    await render(<Checkbox label="Basil" disabledReason="Not yet" />);
    await pressTab();
    await expect.poll(() => tooltip()?.textContent).toBe("Not yet");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => tooltip()).toBeNull();
    await userEvent.unhover(control());
    await userEvent.hover(control());
    await expect.poll(() => tooltip()?.textContent).toBe("Not yet");
  });

  it("Checkbox stays enabled and shows no tooltip while the reason is undefined", async () => {
    const onChange = vi.fn();
    await render(<Checkbox label="Basil" disabledReason={undefined} onCheckedChange={onChange} />);
    expect(control().hasAttribute("aria-disabled")).toBe(false);
    await pressTab();
    await userEvent.keyboard(" ");
    expect(onChange).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(tooltip()).toBeNull();
  });
});
