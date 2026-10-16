import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Button } from "~/components/ouro/button/button";
import { Dialog } from "~/components/ouro/dialog/dialog";
import { Tooltip } from "~/components/ouro/tooltip/tooltip";
import { act } from "~/lib/ouro/testing/act";

// Menu's test closure brings Tooltip, but not Popover's integration tests. Keep
// this composition diagnostic covered against the actual installed Dialog too:
// Tooltip must be inside the trigger, not around the overlay that owns it.
it("explains how to fix a tooltip whose Dialog child cannot receive its trigger ref", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await act(async () => root.render(
      <Tooltip content="Save recipe">
        <Dialog title="Save recipe" trigger={<Button>Save</Button>}>
          Choose a cookbook
        </Dialog>
      </Tooltip>,
    ));
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      '[ouro-ui] Tooltip: the trigger never received the tooltip\'s ref, so the tooltip cannot open; the child must pass its props and ref to an element, and Popover and Dialog do not. Fix: put the Tooltip inside the trigger: trigger={<Tooltip content="…"><Button …/></Tooltip>}.',
    ]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    warn.mockRestore();
  }
});
