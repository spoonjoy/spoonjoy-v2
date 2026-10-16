import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";
import { act } from "~/lib/ouro/testing/act";
import { Button } from "~/components/ouro/button/button";
import { Tooltip } from "~/components/ouro/tooltip/tooltip";
import { OuroProvider } from "~/lib/ouro/ouro-provider";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await act(() => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
});

it("never opens from a tap, and the tap still reaches the trigger", async () => {
  const onClick = vi.fn();
  const host = document.createElement("div");
  host.style.padding = "120px 16px";
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(() =>
    root!.render(
      <OuroProvider>
        <Tooltip content="Add to cookbook">
          <Button onClick={onClick}>Save</Button>
        </Tooltip>
      </OuroProvider>,
    ),
  );
  for (let tap = 0; tap < 2; tap++) await commands.tap('[data-ouro="button"]');
  expect(onClick).toHaveBeenCalledTimes(2);
  // A focus open is immediate, but a hover open waits for the delay: run the page's timers past it.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    await act(async () => vi.advanceTimersByTime(2000));
  } finally {
    vi.useRealTimers();
  }
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  expect(document.querySelector('[data-ouro="tooltip"]')).toBeNull();
});
