import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { Button } from "~/components/ouro/button/button";
import { SheetFrame } from "~/components/ouro/sheet/sheet";
import { act } from "~/lib/ouro/testing/act";

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  document.documentElement.style.fontSize = "";
});

describe("Sheet at 200% text", () => {
  it("keeps its body readable and its footer on screen when the text is doubled on a short window", async () => {
    await page.viewport(550, 450);
    document.documentElement.style.fontSize = "32px";
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <SheetFrame
          title="New event"
          closeLabel="Close"
          side="bottom"
          open
          onOpenChange={() => {}}
          footer={
            <>
              <Button variant="soft">Cancel</Button>
              <Button>Create</Button>
            </>
          }
        >
          <div style={{ height: 800 }}>Form fields</div>
        </SheetFrame>,
      ),
    );
    const sheet = () => document.querySelector<HTMLElement>('[data-ouro="sheet"]')!;
    const rect = (selector: string) => sheet().querySelector<HTMLElement>(selector)!.getBoundingClientRect();
    let last = "";
    await expect
      .poll(() => {
        const now = JSON.stringify([rect("[data-ouro-sheet-content]"), rect("[data-ouro-footer]")]);
        const still = now === last && sheet().getAnimations().length === 0 && !sheet().hasAttribute("data-starting-style");
        last = now;
        return still;
      }, { interval: 50 })
      .toBe(true);
    const body = rect("[data-ouro-sheet-content]");
    const footer = rect("[data-ouro-footer]");
    // At least three lines of the doubled text stay visible.
    expect(body.height).toBeGreaterThanOrEqual(3 * 32 * 1.2);
    expect(footer.top).toBeGreaterThanOrEqual(body.bottom - 0.5);
    expect(footer.bottom).toBeLessThanOrEqual(450 + 0.5);
  });
});
