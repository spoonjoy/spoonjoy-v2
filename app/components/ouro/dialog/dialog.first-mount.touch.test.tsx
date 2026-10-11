import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { commands, page } from "vitest/browser";
import { act } from "~/lib/ouro/testing/act";
import { Dialog } from "~/components/ouro/dialog/dialog";

// Runs in the `touch` project: Chromium as a phone with a coarse pointer. In a file of its
// own, so no Dialog has mounted on the page before the tap: the module state is fresh.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await act(() => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
  await page.viewport(390, 844);
});

/** The app mounts the Dialog only when it opens: `{editing && <Dialog open … />}`. */
function MountOnOpen() {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <button type="button" data-app-opener="" onClick={() => setEditing(true)}>
        Edit
      </button>
      {editing && (
        <Dialog title="Edit recipe" presentation="dialog" open onOpenChange={setEditing}>
          <label>
            Name <input aria-label="Name" />
          </label>
        </Dialog>
      )}
    </>
  );
}

describe("Dialog mounted by the tap that opens it", () => {
  it("focuses the centered popup, not its first input, when no Dialog was on the page before the tap", async () => {
    await page.viewport(844, 390);
    const host = document.createElement("div");
    document.body.append(host);
    nodes.push(host);
    root = createRoot(host);
    await act(() => root!.render(<MountOnOpen />));
    await commands.tap("[data-app-opener]");
    const popup = () => document.querySelector<HTMLElement>('[data-ouro="dialog"]');
    await expect
      .poll(() => {
        const element = popup();
        return Boolean(element && !element.hasAttribute("data-starting-style") && element.getAnimations().length === 0);
      })
      .toBe(true);
    await expect.poll(() => popup()!.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(popup());
  });
});
