import { Select } from "~/components/ouro/select/select";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
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

const courses = [{ value: "a", label: "Art" }, { value: "b", label: "Biology" }];
const trigger = () => document.querySelector<HTMLElement>("[data-ouro-part=trigger]")!;

describe("Select disabledReason", () => {
  it("keeps the trigger focusable with aria-disabled and describes it by the reason", async () => {
    await render(<Select label="Course" options={courses} disabledReason="This term is full" />);
    expect(trigger().getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(trigger().getAttribute("aria-describedby")!.split(" ").at(-1)!)!.textContent).toBe("This term is full");
    await pressTab();
    expect(document.activeElement).toBe(trigger());
  });

  it("opens nothing from a pointer press or from the keyboard", async () => {
    await render(<Select label="Course" options={courses} disabledReason="This term is full" />);
    trigger().click();
    await pressTab();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard(" ");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("shows the reason as a tooltip on keyboard focus and on hover", async () => {
    await render(<Select label="Course" options={courses} disabledReason="This term is full" />);
    await pressTab();
    await expect.poll(() => tooltip()?.textContent).toBe("This term is full");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => tooltip()).toBeNull();
    await userEvent.unhover(trigger());
    await userEvent.hover(trigger());
    await expect.poll(() => tooltip()?.textContent).toBe("This term is full");
  });

  it("opens as usual and shows no tooltip while the reason is undefined", async () => {
    await render(<Select label="Course" options={courses} disabledReason={undefined} />);
    expect(trigger().getAttribute("aria-disabled")).not.toBe("true");
    await pressTab();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => document.querySelector('[role="listbox"]')).not.toBeNull();
    expect(tooltip()).toBeNull();
  });
});
