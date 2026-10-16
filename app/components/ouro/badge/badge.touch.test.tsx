import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { Badge } from "~/components/ouro/badge/badge";
import { act } from "~/lib/ouro/testing/act";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await act(async () => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
});

async function renderBadge(kind: "button" | "link") {
  const host = document.createElement("div");
  host.style.padding = "40px";
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () => root!.render(kind === "link" ? <Badge href="/tags/new">New</Badge> : <Badge onClick={() => {}}>New</Badge>));
  return host.querySelector<HTMLElement>('[data-ouro="badge"]')!;
}

function hits(badge: HTMLElement, x: number, y: number) {
  return document.elementFromPoint(x, y)?.closest("[data-ouro]") === badge;
}

it.each(["button", "link"] as const)("gives a %s badge a 44px hit area on a coarse pointer", async (kind) => {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  const badge = await renderBadge(kind);
  const rect = badge.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  // The visible badge is shorter than 44px, so the probes above and below land outside it.
  expect(rect.height).toBeLessThan(44);
  expect(hits(badge, cx, rect.top - 2)).toBe(true);
  expect(hits(badge, cx, rect.bottom + 2)).toBe(true);
  expect(hits(badge, cx, cy - 21)).toBe(true);
  expect(hits(badge, cx, cy + 21)).toBe(true);
  expect(hits(badge, cx, cy - 23)).toBe(false);
});
