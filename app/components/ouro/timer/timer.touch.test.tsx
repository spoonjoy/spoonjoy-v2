import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { Timer } from "~/components/ouro/timer/timer";
import { TimerTray } from "~/components/ouro/timer/timer-tray";
import { act } from "~/lib/ouro/testing/act";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await act(async () => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
  localStorage.clear();
});

it("gives every timer control a 44px target on a touch screen", async () => {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  localStorage.setItem("ouro-timer:touch", JSON.stringify({ status: "running", duration: 60, endsAt: Date.now() + 30_000 }));
  const host = document.createElement("div");
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <>
        <Timer label="Touch" duration={60} timerId="touch" />
        <TimerTray timers={[{ timerId: "touch", label: "Touch", duration: 60, href: "#touch" }]} />
      </>,
    ),
  );
  const controls = [...host.querySelectorAll<HTMLElement>("[data-ouro-control]")];
  expect(controls).toHaveLength(4);
  for (const control of controls) {
    const target = control.querySelector<HTMLElement>("[data-ouro-touch-target]") ?? control;
    const rect = target.getBoundingClientRect();
    expect(rect.height).toBeGreaterThanOrEqual(44);
    expect(rect.width).toBeGreaterThanOrEqual(44);
  }
});
