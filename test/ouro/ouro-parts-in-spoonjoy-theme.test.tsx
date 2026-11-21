import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it } from "vitest";
import { KitchenHome } from "~/components/cookbook/KitchenHome";
import { MobileNav } from "~/components/navigation/mobile-nav";
import { act } from "~/lib/ouro/testing/act";

// What Spoonjoy's unit tests used to check through Ouro UI's class names (size-16, bg-popover),
// checked here as the rendered result instead, in real browsers with app/styles/tailwind.css
// (vitest.ouro.config.ts). An Ouro UI release that renames a utility or token keeps passing as
// long as Spoonjoy still looks the same, and fails here if it does not (spoonjoy-v2#824).

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
});

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>));
  return host;
}

// The colour a declaration resolves to in Spoonjoy's theme, read the way the browser computes it.
function resolved(value: string) {
  const probe = document.createElement("div");
  probe.style.backgroundColor = value;
  document.body.append(probe);
  const color = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return color;
}

it("draws a recipe with no cover as a 64px initial tile in its row", async () => {
  await render(
    <KitchenHome
      kitchenUser={{ id: "chef-1", username: "alice", photoUrl: null }}
      isOwner={false}
      recipes={[{ id: "broth", title: "broth", description: null, servings: null, coverImageUrl: null, coverProvenanceLabel: null }]}
      cookbooks={[]}
    />,
  );
  const tile = document.querySelector<HTMLElement>('[data-testid="kitchen-recipe-cover-placeholder-broth"]')!;
  const box = tile.parentElement!.getBoundingClientRect();
  expect({ width: box.width, height: box.height }).toEqual({ width: 64, height: 64 });
  const own = tile.getBoundingClientRect();
  expect({ width: own.width, height: own.height }).toEqual({ width: 64, height: 64 });
});

it("draws the tab bar and the search circle on one solid surface, Spoonjoy's photo charcoal", async () => {
  await render(<MobileNav isAuthenticated />);
  const nav = document.querySelector<HTMLElement>('nav[aria-label="Spoonjoy navigation"]')!;
  const search = [...document.querySelectorAll<HTMLAnchorElement>("a")].find(
    (link) => (link.getAttribute("aria-label") ?? link.textContent?.trim()) === "Search",
  );
  expect(search).toBeDefined();
  // app/styles/tailwind.css rebinds --popover to --sj-photo-charcoal for .sj-tab-bar alone.
  const surface = resolved("var(--sj-photo-charcoal)");
  expect(surface).toMatch(/^rgb\(/);
  for (const element of [nav.querySelector("ul")!, search!]) {
    const style = getComputedStyle(element);
    expect(style.backgroundColor).toBe(surface);
    expect(style.backdropFilter).toBe("none");
  }
});
