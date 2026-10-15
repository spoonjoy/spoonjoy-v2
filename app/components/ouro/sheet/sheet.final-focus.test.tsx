import { createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { SheetFrame } from "~/components/ouro/sheet/sheet";
import { act } from "~/lib/ouro/testing/act";

// SheetFrame is the sheet's markup, shared with Dialog, and `finalFocus` is how Dialog, which
// renders its trigger outside the sheet, says where focus goes on close. Dialog's tests cover
// it through Dialog; this covers it in the sheet's own tests, so an app that installs the
// sheet alone still covers every line it installed.

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

describe("SheetFrame finalFocus", () => {
  it("moves focus to finalFocus when the sheet closes", async () => {
    const heading = createRef<HTMLHeadingElement>();
    let setOpen: (open: boolean) => void = () => {};
    function Example({ open }: { open: boolean }) {
      return (
        <>
          <h1 ref={heading} tabIndex={-1}>
            Recipes
          </h1>
          <SheetFrame title="Filters" closeLabel="Close" side="bottom" open={open} onOpenChange={(next) => setOpen(next)} finalFocus={heading}>
            Body
          </SheetFrame>
        </>
      );
    }
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    setOpen = (open) => void act(async () => root!.render(<Example open={open} />));
    await act(async () => root!.render(<Example open />));
    await expect.element(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.activeElement).toBe(heading.current);
  });
});
