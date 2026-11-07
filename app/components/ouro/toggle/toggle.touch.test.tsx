import type { ReactNode, SVGProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import { Toggle } from "~/components/ouro/toggle/toggle";
import { ToggleGroup } from "~/components/ouro/toggle/toggle-group";
import { act } from "~/lib/ouro/testing/act";
import { rotate } from "~/lib/ouro/testing/rotate";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await rotate(390, 844);
  await act(async () => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
});

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.padding = "40px";
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

function Icon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 16 16" {...props} />;
}

it("gives a small toggle a 44px hit area", async () => {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  const host = await render(<Toggle label="Bold" icon={Icon} hideLabel size="sm" />);
  const toggle = host.querySelector<HTMLElement>('[data-ouro="toggle"]')!;
  const rect = toggle.getBoundingClientRect();
  expect(rect.height).toBeLessThan(44);
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  for (const [x, y] of [
    [cx, cy - 21],
    [cx, cy + 21],
    [cx - 21, cy],
    [cx + 21, cy],
  ] as const) {
    expect(document.elementFromPoint(x, y)?.closest("button")).toBe(toggle);
  }
});

it("keeps 44px toggles and 16px text on a landscape phone, past the sm breakpoint", async () => {
  await rotate(844, 390);
  expect(matchMedia("(min-width: 640px)").matches).toBe(true);
  const host = await render(
    <>
      <Toggle label="Bold" />
      <ToggleGroup label="Alignment" items={[{ value: "left", label: "Left" }, { value: "right", label: "Right" }]} />
    </>,
  );
  for (const toggle of host.querySelectorAll<HTMLElement>("button")) {
    expect(toggle.getBoundingClientRect().height).toBe(44);
    expect(getComputedStyle(toggle).fontSize).toBe("16px");
  }
});
