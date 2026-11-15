import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { Button } from "~/components/ouro/button/button";
import { Tooltip } from "~/components/ouro/tooltip/tooltip";
import { act } from "~/lib/ouro/testing/act";

// A tooltip sits on every pressable reaction and on many a toolbar's controls, so a closed one is paid for on each.
// Until a pointer or keyboard focus reaches it, it draws only its trigger.

/** The components React keeps for what the root draws: every fiber but the root, elements and text, context providers included. */
function componentsUnder(host: HTMLElement): number {
  const key = Object.keys(host).find((name) => name.startsWith("__reactContainer$"))!;
  // React's fibers: 3 is the root, 5 an element, 6 a text node; everything else is a component, provider or fragment.
  type Fiber = { tag: number; child: Fiber | null; sibling: Fiber | null; stateNode: { current: Fiber } };
  const count = (fiber: Fiber | null): number => (fiber === null ? 0 : (fiber.tag === 5 || fiber.tag === 6 ? 0 : 1) + count(fiber.child) + count(fiber.sibling));
  // The container keeps the root's first fiber; the tree on screen hangs from the root's current one.
  return count((host as unknown as Record<string, Fiber>)[key]!.stateNode.current.child);
}

/** What the root draws for a node: its elements and its components. */
async function drawn(node: ReactNode) {
  const host = document.createElement("div");
  host.dataset["testHarness"] = "";
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  const weight = { elements: host.querySelectorAll("*").length, components: componentsUnder(host) };
  await act(async () => root.unmount());
  host.remove();
  return weight;
}

describe("Tooltip's weight", () => {
  it("draws a closed tooltip as its trigger and one component more, with no Base UI part", async () => {
    const button = await drawn(<Button>Save</Button>);
    const tooltip = await drawn(
      <Tooltip content="Add to cookbook">
        <Button>Save</Button>
      </Tooltip>,
    );
    expect(tooltip.elements, "elements").toBe(button.elements);
    expect(tooltip.components - button.components, "components").toBeLessThanOrEqual(1);
  });
});
