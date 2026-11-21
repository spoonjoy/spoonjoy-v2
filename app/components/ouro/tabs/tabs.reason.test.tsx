import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { Tabs } from "~/components/ouro/tabs/tabs";
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

const tabs = () => Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'));
const tooltip = () => document.querySelector('[data-ouro="tooltip"]');
const items = [
  { value: "profile", label: "Profile", content: "Profile panel" },
  { value: "sharing", label: "Sharing", content: "Sharing panel", disabledReason: "Sign in to share" },
  { value: "kitchen", label: "Kitchen", content: "Kitchen panel" },
];

describe("Tabs item disabledReason", () => {
  it("turns a tab off with aria-disabled, keeps it focusable and describes it by the reason", async () => {
    await render(<Tabs label="Settings" items={items} />);
    const el = tabs()[1]!;
    expect(el.getAttribute("aria-disabled")).toBe("true");
    expect(el.hasAttribute("disabled")).toBe(false);
    expect(document.getElementById(el.getAttribute("aria-describedby")!)!.textContent).toBe("Sign in to share");
    el.focus();
    expect(document.activeElement).toBe(el);
  });

  it("is never selected by pointer or keyboard, and a first reasoned tab is not the starting one", async () => {
    const onValueChange = vi.fn();
    await render(<Tabs label="Settings" items={[items[1]!, items[0]!, items[2]!]} onValueChange={onValueChange} />);
    expect(tabs()[1]!.getAttribute("aria-selected")).toBe("true");
    tabs()[0]!.click();
    tabs()[0]!.focus();
    expect(document.activeElement).toBe(tabs()[0]);
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{Enter}");
    expect(onValueChange).not.toHaveBeenCalled();
    expect(tabs()[0]!.getAttribute("aria-selected")).toBe("false");
    expect(document.body.textContent).not.toContain("Sharing panel");
  });

  it("shows the reason as its tooltip on keyboard focus and on hover", async () => {
    await render(<Tabs label="Settings" items={items} />);
    await pressTab();
    await pressTab();
    expect(document.activeElement).toBe(tabs()[1]);
    await expect.poll(() => tooltip()?.textContent).toBe("Sign in to share");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => tooltip()).toBeNull();
    await userEvent.unhover(tabs()[1]!);
    await userEvent.hover(tabs()[1]!);
    await expect.poll(() => tooltip()?.textContent).toBe("Sign in to share");
  });

  it("lets the reason win over disabled on an item", async () => {
    await render(<Tabs label="Settings" items={[items[0]!, { ...items[2]!, disabled: true, disabledReason: "Why" }]} />);
    expect(tabs()[1]!.getAttribute("aria-disabled")).toBe("true");
    expect(tabs()[1]!.hasAttribute("disabled")).toBe(false);
  });

  it("leaves a tab a plain one while the reason is undefined, and shows no tooltip", async () => {
    const onValueChange = vi.fn();
    await render(<Tabs label="Settings" onValueChange={onValueChange} items={[items[0]!, { ...items[2]!, disabledReason: undefined }]} />);
    expect(tabs()[1]!.getAttribute("aria-disabled")).not.toBe("true");
    tabs()[1]!.click();
    expect(onValueChange).toHaveBeenCalledWith("kitchen");
    await userEvent.hover(tabs()[1]!);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(tooltip()).toBeNull();
  });
});
