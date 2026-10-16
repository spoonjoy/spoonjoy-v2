import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { ScrollArea } from "~/components/ouro/scroll-area/scroll-area";
import { act } from "~/lib/ouro/testing/act";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await act(async () => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
});

it("leaves touch scrolling to the browser: the scrollbar never takes a touch", async () => {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  const host = document.createElement("div");
  host.style.width = "300px";
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <ScrollArea className="h-40" label="Method">
        <div>
          {Array.from({ length: 40 }, (_, index) => (
            <p key={index} style={{ margin: 0, height: 20, lineHeight: "20px" }}>
              Step {index + 1}
            </p>
          ))}
        </div>
      </ScrollArea>,
    ),
  );
  const area = host.querySelector<HTMLElement>('[data-ouro="scroll-area"]')!;
  const viewport = area.firstElementChild as HTMLElement;
  await expect.poll(() => area.querySelector('[data-orientation="vertical"]')).not.toBeNull();
  const scrollbar = area.querySelector<HTMLElement>('[data-orientation="vertical"]')!;

  // The viewport is a native scroll container that pans with the finger.
  expect(getComputedStyle(viewport).overflowY).toBe("scroll");
  expect(getComputedStyle(viewport).touchAction).toBe("auto");
  // It hands the scroll on to the page at its end, so it never traps a finger.
  expect(getComputedStyle(viewport).overscrollBehaviorY).toBe("auto");

  // The custom scrollbar (touch-action: none, for mouse drags) lets touches through, so a
  // finger on the right edge still pans the viewport, and it is a thin indicator.
  expect(getComputedStyle(scrollbar).pointerEvents).toBe("none");
  const bar = scrollbar.getBoundingClientRect();
  expect(bar.width).toBe(6);
  const hit = document.elementFromPoint(bar.left + bar.width / 2, bar.top + 20);
  expect(viewport.contains(hit)).toBe(true);
});
