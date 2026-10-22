import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { SkipLink } from "~/components/ouro/skip-link/skip-link";
import { act } from "~/lib/ouro/testing/act";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await act(async () => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
});

it("is 44px tall on a touch screen once it shows", async () => {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  const host = document.createElement("div");
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <>
        <SkipLink />
        <main id="main" />
      </>,
    ),
  );
  const link = host.querySelector<HTMLAnchorElement>('[data-ouro="skip-link"]')!;
  link.focus();
  await expect.poll(() => link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  expect(link.getBoundingClientRect().right).toBeLessThan(390);
});
