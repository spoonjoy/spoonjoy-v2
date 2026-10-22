import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { ColorSchemeToggle } from "~/components/ouro/color-scheme-toggle/color-scheme-toggle";
import { act } from "~/lib/ouro/testing/act";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await act(async () => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
});

it("gives the icon button and every segment a 44px target on a touch screen", async () => {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  const host = document.createElement("div");
  host.style.padding = "40px";
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <>
        <ColorSchemeToggle />
        <ColorSchemeToggle variant="segmented" />
      </>,
    ),
  );
  // A tap 21px either side of a control's centre still lands on it: its hit area is at least 44px.
  const reaches = (control: HTMLElement) => {
    const rect = control.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    return [
      [x, y - 21],
      [x, y + 21],
      [x - 21, y],
      [x + 21, y],
    ].every(([px, py]) => control.contains(document.elementFromPoint(px!, py!)));
  };
  const trigger = host.querySelector<HTMLElement>('[data-ouro-part="trigger"]')!;
  expect(reaches(trigger)).toBe(true);
  const segments = [...host.querySelectorAll<HTMLElement>('[role="radio"]')];
  expect(segments).toHaveLength(3);
  for (const segment of segments) {
    const rect = segment.getBoundingClientRect();
    const y = rect.top + rect.height / 2;
    expect(segment.contains(document.elementFromPoint(rect.left + rect.width / 2, y - 21))).toBe(true);
    expect(segment.contains(document.elementFromPoint(rect.left + rect.width / 2, y + 21))).toBe(true);
  }
});
