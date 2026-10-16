import { afterEach, expect, it } from "vitest";
import { commands } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { SwipeActions } from "~/components/ouro/swipe-actions/swipe-actions";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { act } from "~/lib/ouro/testing/act";
import { rotate } from "~/lib/ouro/testing/rotate";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  await commands.touchStep({ type: "touchEnd" });
  await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  scrollTo(0, 0);
  await rotate(390, 844);
});

it("records actual landscape hit geometry before qualifying a visible row's 44px actions", async ({ annotate }) => {
  await rotate(844, 390);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  let invoked = 0;
  await act(async () => root!.render(
    <div style={{ padding: 16 }}>
      <div style={{ height: 200 }} />
      <ItemGroup label="Recipes">
        {["Shakshuka", "Short ribs", "Lemon tart"].map((title, index) => (
          <SwipeActions key={title} label={title}
            leading={[{ label: "Pin", tone: "primary", onClick: () => { invoked++; } }]}
            trailing={[
              { label: "Delete", tone: "destructive", onClick: () => { invoked++; } },
              { label: "Archive", onClick: () => { invoked++; } },
            ]}>
            <Item href={`#recipe-${index}`} title={title} description="Swipe me" />
          </SwipeActions>
        ))}
      </ItemGroup>
      <div style={{ height: 1600 }} />
    </div>,
  ));
  const row = host.querySelectorAll<HTMLElement>('[data-ouro="swipe-actions"]')[1]!;
  row.id = "task21-landscape-native-row";
  const rect = row.getBoundingClientRect();
  const raw = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  const rawHit = document.elementFromPoint(raw.x, raw.y);
  const actual = await commands.shoppingInputBounds("#task21-landscape-native-row");
  await annotate(`T21_LANDSCAPE_GEOMETRY ${JSON.stringify({
    viewport: { width: innerWidth, height: innerHeight },
    visualViewport: { width: visualViewport?.width, height: visualViewport?.height, scale: visualViewport?.scale },
    row: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    publishedInputPoint: raw, actualTopLevelBox: actual, scroll: scrollY,
    hitAtPublishedPoint: {
      tag: rawHit?.tagName ?? null, role: rawHit?.getAttribute("role") ?? null,
      component: rawHit?.getAttribute("data-ouro") ?? null, belongsToExpectedRow: row.contains(rawHit),
    },
    touchAction: getComputedStyle(row).touchAction,
    bodyFont: getComputedStyle(document.body).fontFamily,
  })}`);

  // A real finger can only start on visible content. Preserve the landscape
  // viewport and actual 44px/16px requirements, not an assumed offscreen point.
  row.scrollIntoView({ block: "center" });
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const box = await commands.shoppingInputBounds("#task21-landscape-native-row");
  const current = row.getBoundingClientRect();
  expect(row.contains(document.elementFromPoint(current.left + current.width / 2, current.top + current.height / 2))).toBe(true);
  // The published watcher adds frame origins but does not account for Vitest 4's
  // CSS-scaled phone iframe. Keep that published failing test untouched. This
  // independent command observes real trusted delivery in the actual frame.
  let native!: Awaited<ReturnType<typeof commands.nativeShoppingInput>>;
  await act(async () => { native = await commands.nativeShoppingInput({
      selector: "#task21-landscape-native-row",
      gestures: [{ points: [[.5, .5, 0], [.47, .5, 25], [.43, .5, 50], [.5 - 120 / current.width, .5, 100]] }],
    }); });
  expect(native[0]!.events.some((event) => event.type === "pointerdown" && event.isTrusted && event.targetInRow)).toBe(true);
  await expect.poll(() => row.getAttribute("data-open")).toBe("trailing");
  await expect.poll(() => row.hasAttribute("data-ouro-settling")).toBe(false);
  for (const label of ["Delete", "Archive"]) {
    const button = Array.from(row.querySelectorAll<HTMLButtonElement>("[data-ouro-swipe-actions-side] button"))
      .find((candidate) => candidate.textContent === label)!;
    const bounds = button.getBoundingClientRect();
    expect(Math.min(bounds.width, bounds.height), label).toBeGreaterThanOrEqual(44);
    expect(getComputedStyle(button).fontSize, label).toBe("16px");
  }
  expect(invoked).toBe(0);
  await annotate(`T21_LANDSCAPE_VISIBLE_INPUT ${JSON.stringify({ box, native, open: row.getAttribute("data-open"), invoked })}`);
});
