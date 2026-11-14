import { useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { useMountedOpen } from "~/lib/ouro/use-mounted-open";
import { act } from "~/lib/ouro/testing/act";

// In a file of its own, so nothing has been pressed on the page before the first test.

function Probe({ open }: { open?: boolean }) {
  const mountedOpen = useMountedOpen(open);
  return <span data-probe="">{String(mountedOpen)}</span>;
}

/** Mounts closed, then opens, as an overlay kept on the page does. */
function Toggled() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Probe open={open} />
    </>
  );
}

let root: Root | undefined;

async function render(node: ReactNode) {
  await act(() => root?.unmount());
  document.body.replaceChildren();
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(() => root!.render(node));
}

const probe = () => document.querySelector("[data-probe]")!.textContent;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

describe("useMountedOpen", () => {
  it("does not count an overlay open before anything was pressed", async () => {
    await render(<Probe open />);
    expect(probe()).toBe("false");
  });

  it("counts an overlay mounted open after a press or a key", async () => {
    document.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "mouse" }));
    await render(<Probe open />);
    expect(probe()).toBe("true");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await render(<Probe open />);
    expect(probe()).toBe("true");
  });

  it("does not count an overlay mounted closed or without open, even after it opens", async () => {
    document.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "mouse" }));
    await render(<Probe />);
    expect(probe()).toBe("false");
    await render(<Toggled />);
    await userEvent.click(document.querySelector("button")!);
    expect(probe()).toBe("false");
  });
});
