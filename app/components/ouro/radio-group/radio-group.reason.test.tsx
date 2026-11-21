import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { Radio, RadioGroup } from "~/components/ouro/radio-group/radio-group";
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

const radios = () => Array.from(document.querySelectorAll<HTMLElement>('[role="radio"]'));
const tooltip = () => document.querySelector('[data-ouro="tooltip"]');
const options = [
  { value: "a", label: "Small" },
  { value: "b", label: "Large", disabledReason: "Sold out today" },
  { value: "c", label: "Party" },
];

describe("Radio disabledReason", () => {
  it("turns a choice off with aria-disabled, keeps it focusable and describes it by the reason", async () => {
    await render(<RadioGroup legend="Size" options={options} />);
    const el = radios()[1]!;
    expect(el.getAttribute("aria-disabled")).toBe("true");
    expect(el.hasAttribute("disabled")).toBe(false);
    expect(el.hasAttribute("aria-readonly")).toBe(false);
    expect(document.getElementById(el.getAttribute("aria-describedby")!.split(" ").pop()!)!.textContent).toBe("Sold out today");
    expect(radios()[0]!.hasAttribute("aria-disabled")).toBe(false);
  });

  it("is never picked by pointer or keyboard, the arrow keys skip it and Tab reaches it", async () => {
    const onValueChange = vi.fn();
    await render(<RadioGroup legend="Size" defaultValue="a" onValueChange={onValueChange} options={options} />);
    radios()[1]!.click();
    expect(onValueChange).not.toHaveBeenCalled();
    await pressTab();
    expect(document.activeElement).toBe(radios()[0]);
    await pressTab();
    expect(document.activeElement).toBe(radios()[1]);
    await userEvent.keyboard(" ");
    expect(onValueChange).not.toHaveBeenCalled();
    expect(radios()[1]!.getAttribute("aria-checked")).toBe("false");
    radios()[0]!.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(radios()[2]);
    expect(onValueChange).toHaveBeenCalledWith("c");
  });

  it("shows the reason as its tooltip on keyboard focus and on hover", async () => {
    await render(
      <RadioGroup legend="Size" defaultValue="a">
        <Radio value="a" label="Small" />
        <Radio value="b" label="Large" disabledReason="Sold out today" />
      </RadioGroup>,
    );
    await pressTab();
    await pressTab();
    await expect.poll(() => tooltip()?.textContent).toBe("Sold out today");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => tooltip()).toBeNull();
    await userEvent.unhover(radios()[1]!);
    await userEvent.hover(radios()[1]!);
    await expect.poll(() => tooltip()?.textContent).toBe("Sold out today");
  });

  it("lets the reason win over disabled on a Radio, and plain disabled is not focusable", async () => {
    await render(
      <RadioGroup legend="Size">
        <Radio value="a" label="Plain" disabled />
        <Radio value="b" label="Reasoned" disabled disabledReason="Why" />
      </RadioGroup>,
    );
    expect(radios()[0]!.hasAttribute("disabled")).toBe(true);
    expect(radios()[1]!.getAttribute("aria-disabled")).toBe("true");
    expect(radios()[1]!.hasAttribute("disabled")).toBe(false);
    await pressTab();
    expect(document.activeElement).toBe(radios()[1]);
  });

  it("stays a plain, pickable radio while the reason is undefined, and shows no tooltip", async () => {
    const onValueChange = vi.fn();
    await render(<RadioGroup legend="Size" onValueChange={onValueChange} options={[{ value: "a", label: "Small", disabledReason: undefined }]} />);
    expect(radios()[0]!.hasAttribute("aria-disabled")).toBe(false);
    expect(radios()[0]!.hasAttribute("aria-describedby")).toBe(false);
    radios()[0]!.click();
    expect(onValueChange).toHaveBeenCalledWith("a");
    await userEvent.hover(radios()[0]!);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(tooltip()).toBeNull();
  });
});
