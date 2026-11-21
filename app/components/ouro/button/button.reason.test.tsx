import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { Button } from "~/components/ouro/button/button";
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

const button = () => document.querySelector("button")!;
const tooltip = () => document.querySelector('[data-ouro="tooltip"]');

describe("Button disabledReason looks off", () => {
  it.each(["solid", "soft", "outline", "plain"] as const)("looks as a disabled %s button does, and is marked only when off", async (variant) => {
    await render(
      <>
        <Button variant={variant} disabled>
          Save
        </Button>
        <Button variant={variant} disabledReason="Saving">
          Save
        </Button>
        <Button variant={variant}>Save</Button>
      </>,
    );
    const [disabled, reasoned, on] = Array.from(document.querySelectorAll<HTMLElement>("button"));
    // The look a theme gives a disabled button: Ouro's dims it, and an app's theme may instead draw it in its own
    // colours at full opacity (`--ouro-action-disabled-opacity: 1`, as Spoonjoy's does: spoonjoy-v2#815).
    const look = (el: HTMLElement) => {
      const style = getComputedStyle(el);
      return { opacity: style.opacity, background: style.backgroundColor, color: style.color, cursor: style.cursor };
    };
    expect(look(disabled!), "a disabled button looks different from one that is on").not.toEqual(look(on!));
    expect(look(reasoned!)).toEqual(look(disabled!));
    expect(reasoned!.getAttribute("data-ouro-off")).toBe("");
    expect(getComputedStyle(on!).opacity).toBe("1");
    expect(on!.hasAttribute("data-ouro-off")).toBe(false);
  });

  it("is not dimmed while loading, and keeps its progress cursor", async () => {
    await render(<Button loading>Save</Button>);
    expect(button().hasAttribute("data-ouro-off")).toBe(false);
    expect(getComputedStyle(button()).opacity).toBe("1");
    expect(getComputedStyle(button()).cursor).toBe("progress");
  });
});

describe("Button disabledReason", () => {
  it("turns the button off with aria-disabled, keeps it focusable and describes it by the reason", async () => {
    await render(<Button disabledReason="Add an item first">Check out</Button>);
    const el = button();
    expect(el.getAttribute("aria-disabled")).toBe("true");
    expect(el.hasAttribute("disabled")).toBe(false);
    expect(document.getElementById(el.getAttribute("aria-describedby")!)!.textContent).toBe("Add an item first");
    await pressTab();
    expect(document.activeElement).toBe(el);
  });

  it("does nothing when pressed by pointer or keyboard", async () => {
    const onClick = vi.fn();
    await render(<Button disabledReason="Not yet" onClick={onClick}>Go</Button>);
    button().click();
    await pressTab();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows the reason as its tooltip on keyboard focus and on hover", async () => {
    await render(<Button disabledReason="Not yet">Go</Button>);
    await pressTab();
    await expect.poll(() => tooltip()?.textContent).toBe("Not yet");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => tooltip()).toBeNull();
    await userEvent.unhover(button());
    await userEvent.hover(button());
    await expect.poll(() => tooltip()?.textContent).toBe("Not yet");
  });

  it("keeps the app's own description and the reason together", async () => {
    await render(
      <>
        <span id="own">Saves the draft</span>
        <Button disabledReason="Not yet" aria-describedby="own">Go</Button>
      </>,
    );
    const ids = button().getAttribute("aria-describedby")!.split(" ");
    expect(ids[0]).toBe("own");
    expect(document.getElementById(ids[1]!)!.textContent).toBe("Not yet");
  });

  it("lets the reason win over disabled, and plain disabled stays out of the tab order", async () => {
    await render(
      <>
        <Button disabled>Plain</Button>
        <Button disabled disabledReason="Why">Reasoned</Button>
      </>,
    );
    const [plain, reasoned] = Array.from(document.querySelectorAll("button"));
    expect(plain!.hasAttribute("disabled")).toBe(true);
    expect(plain!.hasAttribute("aria-describedby")).toBe(false);
    expect(reasoned!.getAttribute("aria-disabled")).toBe("true");
    await pressTab();
    expect(document.activeElement).toBe(reasoned);
  });

  it("keeps focus as the reason comes and goes, and works again once it is undefined", async () => {
    const onClick = vi.fn();
    function Demo() {
      const [full, setFull] = useState(false);
      return (
        <Button disabledReason={full ? "Full" : undefined} onClick={() => (onClick(), setFull(true))}>Add</Button>
      );
    }
    await render(<Demo />);
    await pressTab();
    const el = button();
    await userEvent.keyboard("{Enter}");
    expect(document.activeElement).toBe(el);
    expect(el.getAttribute("aria-disabled")).toBe("true");
    await userEvent.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows nothing and stays enabled while the reason is undefined", async () => {
    await render(<Button disabledReason={undefined}>Go</Button>);
    expect(button().hasAttribute("aria-disabled")).toBe(false);
    expect(button().hasAttribute("aria-describedby")).toBe(false);
    await pressTab();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(tooltip()).toBeNull();
  });
});
