import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { page, userEvent } from "vitest/browser";
import { Button } from "~/components/ouro/button/button";
import { Dialog } from "~/components/ouro/dialog/dialog";
import { act } from "~/lib/ouro/testing/act";
import { pressTab } from "~/lib/ouro/testing/tab";

// Runs in Chromium and WebKit. The axe scan (#2617) pressed Escape on one overlay, waited only until it
// stopped reporting itself open, and clicked the next one's trigger while the first still ran its exit
// transition (#2655).

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  await page.viewport(1280, 800);
});

/** The dialog whose title is `name`, open or still closing; null once it has unmounted. */
function overlay(name: string): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
      (element) => document.getElementById(element.getAttribute("aria-labelledby") ?? "")?.textContent?.trim() === name,
    ) ?? null
  );
}

/** The page's button that opens the dialog `name`. */
function trigger(name: string): HTMLElement {
  return [...document.querySelectorAll<HTMLElement>('[data-ouro="button"]')].find((element) => element.textContent === name)!;
}

/** Waits until the dialog has finished opening and Base UI has moved focus into it. */
async function settledOpen(name: string): Promise<HTMLElement> {
  await expect
    .poll(() => {
      const element = overlay(name);
      return Boolean(element?.hasAttribute("data-open") && !element.hasAttribute("data-starting-style") && element.getAnimations().length === 0);
    })
    .toBe(true);
  await expect.poll(() => overlay(name)!.contains(document.activeElement)).toBe(true);
  return overlay(name)!;
}

/**
 * Opens dialog First, presses Escape, and opens dialog Second while First is still closing. Then Tab
 * goes round Second several times: focus stays in Second, and the page behind it is marked hidden.
 */
async function openSecondWhileFirstCloses(presentation: "sheet" | "dialog") {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <>
        <Dialog title="First" presentation={presentation} trigger={<Button>Open first</Button>}>
          <Button>First action</Button>
        </Dialog>
        <Dialog title="Second" presentation={presentation} trigger={<Button>Open second</Button>}>
          <Button>Second action</Button>
          <Button>Another action</Button>
        </Dialog>
      </>,
    ),
  );

  await userEvent.click(trigger("Open first"));
  await settledOpen("First");

  // Escape on First and the press on Second's trigger in one task, before any frame, so First is still mounted and
  // closing when Second opens however loaded the runner: waiting for First to start closing first left a loaded runner
  // time to finish its exit and unmount it, and with it the overlap.
  // The press is dispatched directly, as the scan's was, since First's backdrop can still cover the trigger.
  let closing: HTMLElement | null = null;
  await act(async () => {
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
    trigger("Open second").click();
    closing = overlay("First");
  });
  expect(closing, "First was gone before Second opened").not.toBeNull();
  expect(overlay("First")?.hasAttribute("data-open") ?? false, "First did not start closing").toBe(false);
  const second = await settledOpen("Second");

  // A focus guard hands focus back to the dialog a frame later, so each Tab waits until focus is in it
  // again; a page element that takes focus in between is a leak, whatever happens after it.
  const leaked: string[] = [];
  const onFocusIn = (event: FocusEvent) => {
    const target = event.target as HTMLElement;
    if (!second.contains(target) && !target.hasAttribute("data-base-ui-focus-guard")) leaked.push(target.textContent?.trim() ?? target.tagName);
  };
  document.addEventListener("focusin", onFocusIn, true);
  try {
    for (let press = 0; press < 8; press++) {
      await pressTab();
      await expect.poll(() => second.contains(document.activeElement), { message: `Tab ${press + 1} left Second` }).toBe(true);
    }
  } finally {
    document.removeEventListener("focusin", onFocusIn, true);
  }
  expect(leaked, "Tab reached the page behind Second").toEqual([]);

  // Base UI marks the page behind a modal dialog hidden, so Second's own trigger is out of reach.
  expect(trigger("Open second").closest('[aria-hidden="true"], [inert]'), "the page behind Second is not hidden").not.toBeNull();
}

describe("an overlay opened while the one before it is still closing", () => {
  it("keeps Tab inside the second sheet, and the page behind it hidden, after Escape on the first", async () => {
    await page.viewport(390, 844);
    await openSecondWhileFirstCloses("sheet");
  });

  it("keeps Tab inside the second dialog, centered, and the page behind it hidden, after Escape on the first", async () => {
    await page.viewport(1280, 800);
    await openSecondWhileFirstCloses("dialog");
  });
});

describe("a dialog opened from inside another", () => {
  it("returns focus on Escape to its trigger inside the outer dialog, which stays open", async () => {
    await page.viewport(1280, 800);
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <Dialog title="Outer" trigger={<Button>Open outer</Button>}>
          <Dialog title="Inner" trigger={<Button>Open inner</Button>}>
            <Button>Inside inner</Button>
          </Dialog>
        </Dialog>,
      ),
    );
    trigger("Open outer").click();
    await settledOpen("Outer");
    trigger("Open inner").click();
    await settledOpen("Inner");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.activeElement).toBe(trigger("Open inner"));
    expect(overlay("Outer")?.hasAttribute("data-open")).toBe(true);
  });
});

describe("a centered dialog's focus when it closes", () => {
  it("returns focus to its trigger on Escape, when the trigger was clicked and did not take focus", async () => {
    await page.viewport(1280, 800);
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <Dialog title="Edit" trigger={<Button>Open edit</Button>}>
          <Button>Inside</Button>
        </Dialog>,
      ),
    );
    trigger("Open edit").click();
    await settledOpen("Edit");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.activeElement).toBe(trigger("Open edit"));
  });

  it("keeps focus in a controlled dialog opened after one that is closing", async () => {
    await page.viewport(1280, 800);
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    function Controlled() {
      const [firstOpen, setFirstOpen] = useState(false);
      const [secondOpen, setSecondOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setFirstOpen(true)}>Open first</Button>
          <Button onClick={() => setSecondOpen(true)}>Open second</Button>
          <Dialog title="First" open={firstOpen} onOpenChange={setFirstOpen}>
            <Button>First action</Button>
          </Dialog>
          <Dialog title="Second" open={secondOpen} onOpenChange={setSecondOpen}>
            <Button>Second action</Button>
          </Dialog>
        </>
      );
    }
    await act(async () => root!.render(<Controlled />));
    await userEvent.click(trigger("Open first"));
    await settledOpen("First");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => overlay("First")?.hasAttribute("data-open")).toBe(false);
    trigger("Open second").click();
    const second = await settledOpen("Second");
    // The first dialog unmounts when its exit transition ends; focus must still be in the second then.
    await expect.poll(() => overlay("First")).toBeNull();
    expect(second.contains(document.activeElement)).toBe(true);
  });
});
