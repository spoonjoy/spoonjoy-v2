import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { Card } from "~/components/ouro/card/card";
import { act } from "~/lib/ouro/testing/act";

it("shows a revealDescription card's description on a touch screen", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Card href="#braising" title="Braising" description="Low heat, a lid, and time" revealDescription />));
  const reveal = host.querySelector<HTMLElement>("[data-card-reveal]")!;
  expect(getComputedStyle(reveal).opacity).toBe("1");
  await act(async () => root.unmount());
  host.remove();
});

it("shows a rising card's description on a touch screen", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(<Card href="#braising" title="Braising" description="Low heat, a lid, and time" media={<div style={{ height: 200 }} />} revealDescription="rise" />),
  );
  const reveal = host.querySelector<HTMLElement>('[data-card-reveal="rise"]')!;
  expect(getComputedStyle(reveal).opacity).toBe("1");
  expect(reveal.getBoundingClientRect().height).toBeGreaterThan(0);
  await act(async () => root.unmount());
  host.remove();
});
