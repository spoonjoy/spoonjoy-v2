import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { Button } from "~/components/ouro/button/button";
import { act } from "~/lib/ouro/testing/act";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.


let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await act(async () => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
});

async function renderSmall(href?: string) {
  const host = document.createElement("div");
  host.style.padding = "40px";
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      href ? (
        <Button size="sm" href={href} aria-label="Add">
          +
        </Button>
      ) : (
        <Button size="sm" aria-label="Add">
          +
        </Button>
      ),
    ),
  );
  return host.querySelector<HTMLElement>("[data-ouro]")!;
}

function hits(button: HTMLElement, x: number, y: number) {
  return document.elementFromPoint(x, y)?.closest("[data-ouro]") === button;
}

it.each([undefined, "/x"])("gives a small control a 44px hit area on a coarse pointer (href=%s)", async (href) => {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  const button = await renderSmall(href);
  const rect = button.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  // The visible control is smaller than 44px, so the probes below land outside it.
  expect(rect.height).toBeLessThan(44);
  expect(rect.width).toBeLessThan(44);

  // 2px outside the visible box, still inside the 44px target.
  expect(hits(button, cx, rect.top - 2)).toBe(true);
  expect(hits(button, cx, rect.bottom + 2)).toBe(true);
  expect(hits(button, rect.left - 2, cy)).toBe(true);
  expect(hits(button, rect.right + 2, cy)).toBe(true);
  // The brief's probe: 21px from the center.
  expect(hits(button, cx, cy - 21)).toBe(true);
  expect(hits(button, cx, cy + 21)).toBe(true);

  // Outside 44px it does not reach.
  expect(hits(button, cx, cy - 23)).toBe(false);
  expect(hits(button, cx - 23, cy)).toBe(false);
});
