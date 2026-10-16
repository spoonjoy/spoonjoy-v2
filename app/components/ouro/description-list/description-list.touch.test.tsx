import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { DescriptionList } from "~/components/ouro/description-list/description-list";
import { act } from "~/lib/ouro/testing/act";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await act(async () => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
});

it("keeps 16px text on a touch screen, where a mouse gets 14px", async () => {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  const host = document.createElement("div");
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () => root!.render(<DescriptionList items={[{ term: "Prep time", details: "20 minutes" }]} />));
  for (const cell of host.querySelectorAll("dt, dd")) expect(getComputedStyle(cell).fontSize).toBe("16px");
});
