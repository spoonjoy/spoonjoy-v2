import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { Avatar } from "~/components/ouro/avatar/avatar";
import { act } from "~/lib/ouro/testing/act";

// A chat draws an avatar beside every message, so its count of elements and components is paid
// once per message. Each budget is what the variant draws now: a change that adds to one fails here.

const picture = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

const variants: { variant: string; avatar: ReactElement; loaded?: true; elements: number; components: number }[] = [
  { variant: "initials", avatar: <Avatar name="Ana Lind" />, elements: 3, components: 1 },
  { variant: "a picture, once it has loaded", avatar: <Avatar name="Ana Lind" src={picture} />, loaded: true, elements: 3, components: 1 },
  { variant: "a presence dot", avatar: <Avatar name="Ana Lind" presence="busy" presenceLabel="Busy" />, elements: 6, components: 2 },
  { variant: "a name still loading", avatar: <Avatar name={null} />, elements: 3, components: 2 },
  { variant: "an agent's glyph", avatar: <Avatar name="Halden" shape="agent" />, elements: 5, components: 2 },
];

/** The components React keeps for what the root draws: every fiber but the root, elements and text, context providers included. */
function componentsUnder(host: HTMLElement): number {
  const key = Object.keys(host).find((name) => name.startsWith("__reactContainer$"))!;
  // React's fibers: 3 is the root, 5 an element, 6 a text node; everything else is a component, provider or fragment.
  type Fiber = { tag: number; child: Fiber | null; sibling: Fiber | null; stateNode: { current: Fiber } };
  const count = (fiber: Fiber | null): number => (fiber === null ? 0 : (fiber.tag === 5 || fiber.tag === 6 ? 0 : 1) + count(fiber.child) + count(fiber.sibling));
  // The container keeps the root's first fiber; the tree on screen hangs from the root's current one.
  return count((host as unknown as Record<string, Fiber>)[key]!.stateNode.current.child);
}

describe("Avatar's weight", () => {
  it.each(variants)("draws $variant in no more than $elements elements and $components components", async ({ avatar, loaded, elements, components }) => {
    const host = document.createElement("div");
    host.dataset["testHarness"] = "";
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(avatar));
    if (loaded) await expect.poll(() => host.querySelector("img")).not.toBeNull();
    const drawnElements = host.querySelectorAll("*").length;
    const drawnComponents = componentsUnder(host);
    await act(async () => root.unmount());
    host.remove();
    expect(drawnElements, "elements").toBeLessThanOrEqual(elements);
    expect(drawnComponents, "components").toBeLessThanOrEqual(components);
  });
});
