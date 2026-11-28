import { useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { commands, page } from "vitest/browser";
import { Popover } from "~/components/ouro/popover/popover";
import { Toaster } from "~/components/ouro/toast/toaster";
import { toast } from "~/lib/ouro/toast";
import { act } from "~/lib/ouro/testing/act";
import { pressTab } from "~/lib/ouro/testing/tab";

let root: Root | undefined;

afterEach(async () => {
  await commands.throttleCpu(1);
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

describe("Toaster hand-over on a cold load", () => {
  it("lands the first Tab press from a modal popover on Undo, with the module not yet loaded and the CPU slowed 4×", async () => {
    function Example() {
      const anchor = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={anchor}>Anchor</button>
          <Toaster />
          <Popover title="Go to date" open onOpenChange={() => {}} anchor={anchor} presentation="popover">
            <button>Pick</button>
          </Popover>
        </>
      );
    }
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root!.render(<Example />));
    await act(async () => void toast("Event deleted", { duration: 0, action: { label: "Undo", onClick: () => {} } }));
    await expect.element(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await commands.throttleCpu(4);
    const controls = document.querySelectorAll<HTMLElement>('[role="dialog"][data-open]:not([data-ouro="toast"]) button');
    controls[controls.length - 1]!.focus();
    await pressTab();
    expect(document.activeElement?.textContent).toBe("Undo");
  });
});
