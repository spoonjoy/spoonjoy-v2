import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { commands } from "vitest/browser";
import { Item } from "~/components/ouro/item/item";
import { SwipeActions } from "~/components/ouro/swipe-actions/swipe-actions";
import { act } from "~/lib/ouro/testing/act";
import { rotate } from "~/lib/ouro/testing/rotate";
import type { touchHostGeometry, touchHostWrongPoint } from "../../.github/touch-host-probe";

declare module "vitest/browser" {
  interface BrowserCommands {
    touchHostGeometry: typeof touchHostGeometry;
    touchHostWrongPoint: typeof touchHostWrongPoint;
  }
}

it("records native host geometry and trusted row input through a full orientation round trip", async ({ annotate }) => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let actions = 0;
  const pointers: Array<{ trusted: boolean; type: string; x: number; y: number }> = [];
  await act(async () => root.render(
    <div style={{ padding: 16 }}>
      <div data-host-probe-spacer="" style={{ height: 200 }} />
      <SwipeActions label="Host probe" trailing={[
        { label: "Delete", tone: "destructive", onClick: () => actions++ },
        { label: "Archive", onClick: () => actions++ },
      ]}>
        <Item title="Host probe" description="Native geometry witness" />
      </SwipeActions>
      <div style={{ height: 1000 }} />
    </div>,
  ));
  const row = host.querySelector<HTMLElement>('[data-ouro="swipe-actions"]')!;
  row.setAttribute("data-host-probe-row", "");
  row.addEventListener("pointerdown", (event) => {
    pointers.push({ trusted: event.isTrusted, type: event.pointerType, x: event.clientX, y: event.clientY });
  });
  try {
    for (const [stage, width, height] of [
      ["portrait", 390, 844],
      ["landscape", 844, 390],
      ["portrait-restored", 390, 844],
    ] as const) {
      await rotate(width, height);
      const geometry = await commands.touchHostGeometry("[data-host-probe-row]");
      await annotate(`TOUCH_HOST_GEOMETRY ${JSON.stringify({ stage, ...geometry })}`);
      expect(geometry.local.inner).toEqual({ width, height });
      expect(geometry.local.coarse).toBe(true);
      expect(geometry.local.maxTouchPoints).toBeGreaterThan(0);
      expect(geometry.local.landscape).toBe(width > height);
      expect(geometry.host.visual?.scale).toBe(1);
      expect(geometry.scale).toEqual({ x: 1, y: 1 });
      expect(geometry.origin).toEqual({ x: 0, y: 0 });

      const before = pointers.length;
      await commands.touchHostWrongPoint();
      expect(pointers).toHaveLength(before);
      expect(row.getAttribute("data-open")).toBeNull();
      expect(actions).toBe(0);

      const rect = row.getBoundingClientRect();
      const from: [number, number] = [rect.left + rect.width / 2, rect.top + rect.height / 2];
      await commands.touchDrag({ from, to: [from[0] - 120, from[1]], steps: 10, durationMs: 100 });
      await expect.poll(() => row.getAttribute("data-open")).toBe("trailing");
      expect(pointers).toHaveLength(before + 1);
      expect(pointers.at(-1)?.trusted).toBe(true);
      expect(pointers.at(-1)?.type).toBe("touch");
      expect(actions).toBe(0);
      for (const button of row.querySelectorAll<HTMLButtonElement>("[data-ouro-swipe-actions-side] button")) {
        const box = button.getBoundingClientRect();
        expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
        expect(getComputedStyle(button).fontSize).toBe("16px");
      }
      await annotate(`TOUCH_HOST_NATIVE ${JSON.stringify({ stage, from, pointers, actions })}`);
      await commands.touchHostWrongPoint();
      await expect.poll(() => row.getAttribute("data-open")).toBeNull();
    }
  } finally {
    await rotate(390, 844);
    await annotate(`TOUCH_HOST_CLEANUP ${JSON.stringify(await commands.touchHostGeometry("[data-host-probe-row]"))}`);
    await act(async () => root.unmount());
    host.remove();
  }
});
