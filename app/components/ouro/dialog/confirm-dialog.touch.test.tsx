import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useState, type ReactNode } from "react";
import { commands } from "vitest/browser";
import { act } from "~/lib/ouro/testing/act";
import { Button } from "~/components/ouro/button/button";
import { ConfirmDialog } from "~/components/ouro/dialog/confirm-dialog";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await act(() => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
});

async function mount(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(() => root!.render(node));
}

/** Waits for the open popup's entrance, then for the focus it moves to Cancel. */
async function cancelFocused() {
  await expect
    .poll(() => {
      const element = document.querySelector<HTMLElement>('[data-ouro="dialog"]');
      return Boolean(element && !element.hasAttribute("data-starting-style") && element.getAnimations().length === 0);
    })
    .toBe(true);
  await expect.poll(() => document.activeElement?.textContent).toBe("Cancel");
}

/** A controlled ConfirmDialog the app opens from its own button. */
function ControlledConfirm() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-app-opener="" onClick={() => setOpen(true)}>
        Delete
      </button>
      <ConfirmDialog title="Delete recipe?" confirmLabel="Delete" onConfirm={() => {}} open={open} onOpenChange={setOpen} />
    </>
  );
}

describe("ConfirmDialog initial focus after a tap", () => {
  it("focuses Cancel when its trigger is tapped", async () => {
    await mount(<ConfirmDialog title="Delete recipe?" confirmLabel="Delete" onConfirm={() => {}} trigger={<Button>Delete</Button>} />);
    await commands.tap('[data-ouro="button"]');
    await cancelFocused();
  });

  it("focuses Cancel when the app's own button is tapped, as with its trigger", async () => {
    await mount(<ControlledConfirm />);
    await commands.tap("[data-app-opener]");
    await cancelFocused();
  });
});
