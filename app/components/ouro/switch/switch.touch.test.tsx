import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { commands } from "vitest/browser";
import { Switch } from "~/components/ouro/switch/switch";
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
  host.style.padding = "24px";
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

/** The element a tap at 21px above and below the control's center lands on, by role. */
function tapTargets(control: HTMLElement, role: string): (Element | null | undefined)[] {
  const rect = control.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return [cy - 21, cy + 21].map((y) => document.elementFromPoint(cx, y)?.closest(`[role="${role}"]`));
}

it("gives the switch a 44px hit area, though it is 24px tall", async () => {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  const host = await render(<Switch label="Wi-Fi" />);
  const track = host.querySelector<HTMLElement>('[role="switch"]')!;
  expect(track.getBoundingClientRect().height).toBe(24);
  expect(tapTargets(track, "switch")).toEqual([track, track]);
});

it("flips on a tap on the switch or the label", async () => {
  const host = await render(<Switch label="Wi-Fi" />);
  const track = host.querySelector<HTMLElement>('[role="switch"]')!;
  await commands.tap('[role="switch"]');
  expect(track.getAttribute("aria-checked")).toBe("true");
  await commands.tap("label");
  expect(track.getAttribute("aria-checked")).toBe("false");
});

it("keeps the phone size and 16px label on a landscape phone, past the sm breakpoint", async () => {
  await rotate(844, 390);
  const host = await render(<Switch label="Wi-Fi" />);
  expect(host.querySelector<HTMLElement>('[role="switch"]')!.getBoundingClientRect().height).toBe(24);
  expect(getComputedStyle(host.querySelector("label")!).fontSize).toBe("16px");
});

it("switches from a tap between two lines of a wrapped label", async () => {
  const host = await render(
    <div style={{ width: 220 }}>
      <Switch label="Tell me when someone cooks one of my recipes" />
    </div>,
  );
  const label = host.querySelector("label")!;
  const control = host.querySelector<HTMLElement>('[role="switch"]')!;
  const lines = [...label.getClientRects()];
  expect(lines.length).toBeGreaterThan(1);
  const x = lines[0]!.left + 10;
  const y = (lines[0]!.bottom + lines[1]!.top) / 2;
  expect(document.elementFromPoint(x, y)).toBe(label);
  await commands.touchStep({ type: "touchStart", x, y });
  await commands.touchStep({ type: "touchEnd" });
  await expect.poll(() => control.getAttribute("aria-checked")).toBe("true");
});
