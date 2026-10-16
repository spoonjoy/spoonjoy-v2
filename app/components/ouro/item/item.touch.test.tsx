import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { act } from "~/lib/ouro/testing/act";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await act(async () => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
});

it("makes a linked row at least 44px tall at every size, so it is a full touch target", async () => {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  const host = document.createElement("div");
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <ItemGroup aria-label="Recipes">
        <Item href="/a" title="Small" size="sm" data-row="sm" />
        <Item href="/b" title="Medium" data-row="md" />
        <Item href="/c" title="Outline" size="sm" variant="outline" data-row="outline" />
      </ItemGroup>,
    ),
  );
  for (const row of ["sm", "md", "outline"]) {
    const item = host.querySelector(`[data-row="${row}"]`)!;
    expect(item.getBoundingClientRect().height, row).toBeGreaterThanOrEqual(44);
  }
});
