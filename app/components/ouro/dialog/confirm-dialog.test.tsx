import { useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { Button } from "~/components/ouro/button/button";
import { ConfirmDialog, type ConfirmDialogProps } from "~/components/ouro/dialog/confirm-dialog";
import { act } from "~/lib/ouro/testing/act";

// Runs in Chromium and WebKit.


const FIX =
  "Pass trigger={<Button>…</Button>} for an uncontrolled confirmation, or open and onOpenChange to control it.";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  await page.viewport(1280, 800);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

const popup = () => document.querySelector<HTMLElement>('[data-ouro="dialog"]');
const trigger = () => document.querySelector<HTMLElement>('[data-ouro="button"]')!;
const button = (name: string) => page.getByRole("alertdialog").getByRole("button", { name });

async function settled() {
  await expect
    .poll(
      () => {
        const element = popup();
        return Boolean(element && !element.hasAttribute("data-starting-style") && element.getAnimations().length === 0);
      },
      { interval: 50 },
    )
    .toBe(true);
}

async function open(props: Partial<ConfirmDialogProps> = {}) {
  await render(
    <ConfirmDialog
      title="Delete recipe?"
      description="This can't be undone."
      confirmLabel="Delete"
      onConfirm={() => {}}
      trigger={<Button>Delete</Button>}
      {...(props as object)}
    />,
  );
  await userEvent.click(trigger());
  await settled();
  return popup()!;
}

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("ConfirmDialog", () => {
  it("is an alert dialog named by its title and described by its description", async () => {
    const element = await open();
    await expect.element(page.getByRole("alertdialog", { name: "Delete recipe?" })).toBeVisible();
    const describedBy = element.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)!.textContent).toBe("This can't be undone.");
  });

  it("gives Cancel focus on open", async () => {
    await open();
    expect(document.activeElement).toBe(button("Cancel").element());
  });

  it("does not close on an outside press", async () => {
    await open();
    await userEvent.click(document.body, { position: { x: 10, y: 10 } });
    // A dismissal would have started by now: the press is handled and React has committed.
    await act(async () => {});
    expect(popup()!.hasAttribute("data-open")).toBe(true);
    expect(popup()!.hasAttribute("data-ending-style")).toBe(false);
  });

  it("closes from Cancel without confirming, and takes cancelLabel", async () => {
    const onConfirm = vi.fn();
    await open({ onConfirm, cancelLabel: "Keep it" });
    await userEvent.click(button("Keep it"));
    await expect.poll(() => popup()).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("moves focus to finalFocus when the confirmed action removes the trigger", async () => {
    function Recipe() {
      const [deleted, setDeleted] = useState(false);
      const headingRef = useRef<HTMLHeadingElement>(null);
      return (
        <main>
          <h1 ref={headingRef} tabIndex={-1}>
            {deleted ? "Recipe deleted" : "Pancakes"}
          </h1>
          {!deleted && (
            <ConfirmDialog
              title="Delete recipe?"
              confirmLabel="Delete"
              tone="destructive"
              finalFocus={headingRef}
              onConfirm={() => setDeleted(true)}
              trigger={<Button>Delete recipe</Button>}
            />
          )}
        </main>
      );
    }
    await render(<Recipe />);
    await userEvent.click(trigger());
    await settled();
    await userEvent.click(button("Delete"));
    await expect.poll(() => document.activeElement?.textContent).toBe("Recipe deleted");
  });

  it.each(["Cancel", "Escape"] as const)(
    "returns focus to the trigger after %s even when finalFocus is set, because the trigger still exists",
    async (how) => {
      function Page() {
        const headingRef = useRef<HTMLHeadingElement>(null);
        return (
          <main>
            <h1 ref={headingRef} tabIndex={-1}>
              Pancakes
            </h1>
            <ConfirmDialog
              title="Delete recipe?"
              confirmLabel="Delete"
              finalFocus={headingRef}
              onConfirm={() => {}}
              trigger={<Button>Delete recipe</Button>}
            />
          </main>
        );
      }
      await render(<Page />);
      await userEvent.click(trigger());
      await settled();
      if (how === "Cancel") await userEvent.click(button("Cancel"));
      else await userEvent.keyboard("{Escape}");
      await expect.poll(() => popup()).toBeNull();
      await expect.poll(() => document.activeElement).toBe(trigger());
    },
  );

  it("returns focus to the trigger after a confirm when finalFocus points at no element", async () => {
    await open({ finalFocus: { current: null } });
    await userEvent.click(button("Delete"));
    await expect.poll(() => popup()).toBeNull();
    await expect.poll(() => document.activeElement).toBe(trigger());
  });

  it("moves focus to finalFocus when an async confirm resolves", async () => {
    const pending = deferred();
    function Page() {
      const headingRef = useRef<HTMLHeadingElement>(null);
      return (
        <main>
          <h1 ref={headingRef} tabIndex={-1}>
            Recipes
          </h1>
          <ConfirmDialog
            title="Delete recipe?"
            confirmLabel="Delete"
            finalFocus={headingRef}
            onConfirm={() => pending.promise}
            trigger={<Button>Delete recipe</Button>}
          />
        </main>
      );
    }
    await render(<Page />);
    await userEvent.click(trigger());
    await settled();
    await userEvent.click(button("Delete"));
    await act(async () => pending.resolve());
    await expect.poll(() => popup()).toBeNull();
    await expect.poll(() => document.activeElement?.textContent).toBe("Recipes");
  });

  it("returns focus to the trigger when the app closes a confirmation it reopened after a confirm", async () => {
    let setOpenFromApp!: (next: boolean) => void;
    function Page() {
      const [openState, setOpen] = useState(false);
      const headingRef = useRef<HTMLHeadingElement>(null);
      setOpenFromApp = setOpen;
      return (
        <main>
          <h1 ref={headingRef} tabIndex={-1}>
            Recipes
          </h1>
          <Button onClick={() => setOpen(true)}>Delete recipe</Button>
          <ConfirmDialog
            title="Delete recipe?"
            confirmLabel="Delete"
            finalFocus={headingRef}
            onConfirm={() => {}}
            open={openState}
            onOpenChange={setOpen}
          />
        </main>
      );
    }
    await render(<Page />);
    await userEvent.click(trigger());
    await settled();
    await userEvent.click(button("Delete"));
    await expect.poll(() => popup()).toBeNull();
    await expect.poll(() => document.activeElement?.textContent).toBe("Recipes");

    // The app reopens the confirmation from its own button, then closes it itself
    // (on navigation, say) without the user confirming.
    await userEvent.click(trigger());
    await settled();
    await act(async () => setOpenFromApp(false));
    await expect.poll(() => popup()).toBeNull();
    await expect.poll(() => document.activeElement).toBe(trigger());
  });

  it("returns focus to the trigger after Cancel when finalFocus is not set", async () => {
    await open();
    await userEvent.click(button("Cancel"));
    await expect.poll(() => document.activeElement).toBe(trigger());
  });

  it("closes right away when onConfirm returns nothing", async () => {
    const onConfirm = vi.fn();
    await open({ onConfirm });
    await userEvent.click(button("Delete"));
    expect(onConfirm).toHaveBeenCalledOnce();
    await expect.poll(() => popup()).toBeNull();
  });

  it("shows aria-busy on confirm while the promise is pending, then closes when it resolves", async () => {
    // The test settles the promise itself, after checking the busy state: a timer here
    // could fire before the click's round trip to the browser returns.
    const pending = deferred();
    await open({ onConfirm: () => pending.promise });
    await userEvent.click(button("Delete"));
    await expect.poll(() => button("Delete").element().getAttribute("aria-busy")).toBe("true");
    expect(popup()).not.toBeNull();
    await act(async () => pending.resolve());
    await expect.poll(() => popup()).toBeNull();
  });

  it("stays open when the promise rejects, clears busy, and warns with the error", async () => {
    const pending = deferred();
    await open({ onConfirm: () => pending.promise });
    await userEvent.click(button("Delete"));
    await act(async () => pending.reject(new Error("Network down")));
    await expect.poll(() => button("Delete").element().hasAttribute("aria-busy")).toBe(false);
    // The rejection is handled (busy cleared), so a close would have started.
    expect(popup()!.hasAttribute("data-open")).toBe(true);
    expect(popup()!.hasAttribute("data-ending-style")).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] ConfirmDialog: onConfirm rejected with "Network down", so the dialog stayed open. Fix: onConfirm={() => remove().catch((error) => { setError(error.message); throw error; })} description={error}.',
    );
  });

  it("warns with a rejection that is not an Error", async () => {
    await open({ onConfirm: () => Promise.reject("offline") });
    await userEvent.click(button("Delete"));
    await expect.poll(() => warn.mock.calls.length).toBe(1);
    expect(String(warn.mock.calls[0]![0])).toContain('onConfirm rejected with "offline"');
  });

  it("ignores a promise that settles after the user cancelled", async () => {
    const first = deferred();
    const onOpenChange = vi.fn();
    function Controlled() {
      const [openState, setOpen] = useState(true);
      return (
        <ConfirmDialog
          title="Delete recipe?"
          confirmLabel="Delete"
          onConfirm={() => first.promise}
          open={openState}
          onOpenChange={(next) => {
            onOpenChange(next);
            setOpen(next);
          }}
        />
      );
    }
    await render(<Controlled />);
    await settled();
    await userEvent.click(button("Delete"));
    await userEvent.click(button("Cancel"));
    await expect.poll(() => popup()).toBeNull();
    await act(async () => first.resolve());
    expect(onOpenChange.mock.calls).toEqual([[false]]);
  });

  it("keeps a newer confirm busy when an older attempt rejects after the user left it", async () => {
    const first = deferred();
    const second = deferred();
    const onConfirm = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await open({ onConfirm });
    await userEvent.click(button("Delete"));
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => popup()).toBeNull();
    await userEvent.click(trigger());
    await settled();
    await userEvent.click(button("Delete"));
    expect(button("Delete").element().getAttribute("aria-busy")).toBe("true");
    await act(() => first.reject(new Error("first failed")));
    // Wait until the stale rejection is handled, then check it left the newer confirm busy.
    await vi.waitFor(
      () =>
        expect(warn).toHaveBeenCalledWith(
          '[ouro-ui] ConfirmDialog: onConfirm rejected with "first failed" after the user had left that confirmation. Fix: onConfirm={() => remove().catch((error) => { setError(error.message); throw error; })} description={error}.',
        ),
      { timeout: 10_000 },
    );
    await act(async () => {});
    expect(button("Delete").element().getAttribute("aria-busy")).toBe("true");
    await act(() => second.resolve());
    await expect.poll(() => popup()).toBeNull();
  });

  it("treats a synchronous throw from onConfirm like a rejection: stays open and warns", async () => {
    const windowErrors: string[] = [];
    const onError = (event: ErrorEvent) => windowErrors.push(event.message);
    window.addEventListener("error", onError);
    await open({
      onConfirm: () => {
        throw new Error("sync boom");
      },
    });
    await userEvent.click(button("Delete"));
    await expect.poll(() => warn.mock.calls.length).toBe(1);
    window.removeEventListener("error", onError);
    expect(String(warn.mock.calls[0]![0])).toContain('onConfirm rejected with "sync boom", so the dialog stayed open');
    expect(popup()).not.toBeNull();
    expect(button("Delete").element().hasAttribute("aria-busy")).toBe(false);
    expect(windowErrors).toEqual([]);
  });

  it("closes a controlled confirmation through onOpenChange when the promise resolves", async () => {
    const onOpenChange = vi.fn();
    await render(
      <ConfirmDialog
        title="Delete recipe?"
        confirmLabel="Delete"
        onConfirm={() => Promise.resolve()}
        open
        onOpenChange={onOpenChange}
      />,
    );
    await settled();
    await userEvent.click(button("Delete"));
    await expect.poll(() => onOpenChange.mock.calls).toEqual([[false]]);
  });

  it('gives the confirm button data-tone="destructive" with tone="destructive", and primary by default', async () => {
    await open({ tone: "destructive" });
    expect(button("Delete").element().getAttribute("data-tone")).toBe("destructive");
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    await open();
    expect(button("Delete").element().getAttribute("data-tone")).toBe("primary");
  });

  it.each([
    ["danger", 'tone="danger" is not a tone. Fix: <ConfirmDialog tone="destructive">.'],
    ["success", 'tone="success" is not a tone; use "primary", "destructive". Fix: <ConfirmDialog tone="primary">.'],
  ])("renders a primary confirm button for tone=%j and warns once with the fix", async (tone, message) => {
    await open({ tone } as object);
    expect(button("Delete").element().getAttribute("data-tone")).toBe("primary");
    expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([`[ouro-ui] ConfirmDialog: ${message}`]);
  });

  it("stays centered on a phone with side margins and stacks its actions with confirm at the bottom", async () => {
    await page.viewport(390, 844);
    const element = await open();
    expect(element.getAttribute("data-ouro-presentation")).toBe("dialog");
    const rect = element.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(16);
    expect(innerWidth - rect.right).toBeGreaterThanOrEqual(16);
    expect(Math.abs(rect.top + rect.height / 2 - innerHeight / 2)).toBeLessThanOrEqual(1);
    const cancel = button("Cancel").element().getBoundingClientRect();
    const confirm = button("Delete").element().getBoundingClientRect();
    expect(cancel.bottom).toBeLessThanOrEqual(confirm.top);
    expect(confirm.width).toBe(cancel.width);
  });

  it("renders on the server without throwing", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(
      <ConfirmDialog title="Delete?" confirmLabel="Delete" onConfirm={() => {}} trigger={<Button>Delete</Button>} />,
    );
    expect(html).toContain(">Delete<");
    expect(error).not.toHaveBeenCalled();
  });
});

describe("ConfirmDialog dev messages", () => {
  it("throws the exact fix when neither trigger nor open is passed", () => {
    // @ts-expect-error -- neither trigger nor open
    const dialog = <ConfirmDialog title="Delete?" confirmLabel="Delete" onConfirm={() => {}} />;
    expect(() => renderToString(dialog)).toThrow(
      `[ouro-ui] ConfirmDialog: needs trigger or open with onOpenChange. Fix: ${FIX}`,
    );
  });

  it("throws the exact fix when both trigger and open are passed", () => {
    const dialog = (
      // @ts-expect-error -- both trigger and open
      <ConfirmDialog title="Delete?" confirmLabel="Delete" onConfirm={() => {}} trigger={<Button>D</Button>} open onOpenChange={() => {}} />
    );
    expect(() => renderToString(dialog)).toThrow(`[ouro-ui] ConfirmDialog: takes trigger or open, not both. Fix: ${FIX}`);
  });

  it("throws the exact fix when open comes without onOpenChange", () => {
    // @ts-expect-error -- open without onOpenChange
    const dialog = <ConfirmDialog title="Delete?" confirmLabel="Delete" onConfirm={() => {}} open />;
    expect(() => renderToString(dialog)).toThrow(`[ouro-ui] ConfirmDialog: open needs onOpenChange. Fix: ${FIX}`);
  });

  it.each([[""], [undefined]])("warns when the title is missing (%j): it names the confirmation for screen readers", async (title) => {
    await open({ title } as object);
    expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      '[ouro-ui] ConfirmDialog: title is required; it names the confirmation for screen readers. Fix: <ConfirmDialog title="Delete recipe?">.',
    ]);
  });

  it("warns once about guessed props and drops them from the DOM", async () => {
    const guessed = {
      isOpen: true,
      onClose: () => {},
      onCancel: () => {},
      destructive: true,
      confirmText: "Go",
      cancelText: "Keep",
      variant: "destructive",
    } as object;
    const element = await open(guessed);
    expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      "[ouro-ui] ConfirmDialog: isOpen is not a prop. Fix: <ConfirmDialog open={open} onOpenChange={setOpen}>.",
      "[ouro-ui] ConfirmDialog: onClose is not a prop. Fix: <ConfirmDialog open={open} onOpenChange={setOpen}>.",
      "[ouro-ui] ConfirmDialog: onCancel is not a prop; Cancel calls onOpenChange(false). Fix: <ConfirmDialog open={open} onOpenChange={setOpen}>.",
      '[ouro-ui] ConfirmDialog: destructive is not a prop. Fix: <ConfirmDialog tone="destructive">.',
      '[ouro-ui] ConfirmDialog: confirmText is not a prop. Fix: <ConfirmDialog confirmLabel="Delete">.',
      '[ouro-ui] ConfirmDialog: cancelText is not a prop. Fix: <ConfirmDialog cancelLabel="Keep">.',
      '[ouro-ui] ConfirmDialog: variant is not a prop. Fix: <ConfirmDialog tone="destructive">.',
    ]);
    for (const name of ["isopen", "destructive", "confirmtext", "canceltext", "variant"]) expect(element.hasAttribute(name)).toBe(false);
  });
});
