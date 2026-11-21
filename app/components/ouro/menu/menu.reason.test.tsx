import { Button } from "~/components/ouro/button/button";
import { Menu } from "~/components/ouro/menu/menu";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
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

const tooltip = () => document.querySelector('[data-ouro="tooltip"]');

const item = () => document.querySelector<HTMLElement>('[role="menuitem"][aria-disabled="true"]')!;

async function openMenu(onClick = vi.fn(), reason: string | null = "Nothing copied yet") {
  await render(
    <Menu
      trigger={<Button>Edit</Button>}
      items={[{ label: "Cut", onClick: vi.fn() }, { label: "Paste", onClick, disabledReason: reason ?? undefined }, { label: "Delete", onClick: vi.fn() }]}
    />,
  );
  await pressTab();
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => document.querySelector('[role="menu"]')).not.toBeNull();
  return onClick;
}

describe("Menu item disabledReason", () => {
  it("keeps the item reachable by arrow keys, with aria-disabled and the reason as its description", async () => {
    await openMenu();
    expect(document.getElementById(item().getAttribute("aria-describedby")!)!.textContent).toBe("Nothing copied yet");
    await userEvent.keyboard("{ArrowDown}");
    await expect.poll(() => document.activeElement).toBe(item());
  });

  it("does nothing when chosen by pointer, Enter or Space, and leaves the menu open", async () => {
    const onClick = await openMenu();
    item().click();
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onClick).not.toHaveBeenCalled();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  });

  it("shows the reason as a tooltip on keyboard focus and on hover", async () => {
    await openMenu();
    await userEvent.keyboard("{ArrowDown}");
    await expect.poll(() => tooltip()?.textContent).toBe("Nothing copied yet");
    await userEvent.keyboard("{ArrowDown}");
    await expect.poll(() => tooltip()).toBeNull();
    await userEvent.hover(item());
    await expect.poll(() => tooltip()?.textContent).toBe("Nothing copied yet");
  });

  it("chooses as usual while the reason is undefined", async () => {
    const onClick = await openMenu(vi.fn(), null);
    const paste = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((el) => el.textContent?.includes("Paste"))!;
    expect(paste.getAttribute("aria-disabled")).not.toBe("true");
    await userEvent.click(paste);
    expect(onClick).toHaveBeenCalledTimes(1);
    await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull();
  });
});
