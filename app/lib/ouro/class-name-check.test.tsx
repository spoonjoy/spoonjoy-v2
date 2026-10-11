import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { findClassNameProblem, useAppearanceClassNameCheck } from "~/lib/ouro/class-name-check";
import { act } from "~/lib/ouro/testing/act";


const roots: Root[] = [];
async function render(node: ReactNode) {
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  await act(async () => root.render(node));
  return { rerender: (next: ReactNode) => act(async () => root.render(next)) };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
});

function Probe({ className }: { className?: string | undefined }) {
  useAppearanceClassNameCheck("Button", className, 'tone="destructive"');
  return null;
}

describe("findClassNameProblem", () => {
  it.each([
    "bg-red-500",
    "bg-[#fff]",
    "bg-[url(https://x.test/y.png)]",
    "bg-red-500!",
    "!bg-red-500",
    "hover:text-red-500",
    "md:hover:rounded-lg",
    "dark:bg-black",
    "dark:mt-4",
    "md:dark:mt-4",
    "[&_svg]:fill-current",
    "p-2 shadow-md",
    "border",
    "rounded",
    "shadow",
    "ring",
    "!border",
    "sm:rounded",
    "border-t",
    "ring-0",
    "shadow-none",
    "font-bold",
    "text-sm",
    "stroke-2",
    "from-red-500",
  ])("flags %s as appearance", (input) => {
    expect(findClassNameProblem(input)?.kind).toBe("appearance");
  });

  it.each(["text-center", "text-left", "text-right", "text-justify", "text-start", "text-end", "md:text-center", "!text-center"])(
    "flags %s as alignment",
    (input) => expect(findClassNameProblem(input)?.kind).toBe("align"),
  );

  it("returns the first offending token as written", () => {
    expect(findClassNameProblem("mt-4 !bg-red-500 text-center")).toEqual({
      token: "!bg-red-500",
      kind: "appearance",
    });
  });

  it.each([
    "mt-4 w-full",
    "grid col-span-2",
    "size-4",
    "grid-cols-2",
    "top-0 left-1/2",
    "w-[calc(100%-1rem)]",
    "-translate-y-1",
    "whitespace-nowrap",
    "flex items-center justify-between gap-2",
    "md:flex-row sm:p-4 hover:mt-2",
    "bgx-1 context-menu borders shadowed ringed",
    "[&_svg]:size-4",
    // Text wrapping, overflow and table layout are layout, not appearance.
    "text-wrap",
    "text-nowrap",
    "text-balance",
    "text-pretty",
    "text-ellipsis",
    "text-clip",
    "md:text-nowrap",
    "border-collapse",
    "border-separate",
    "border-spacing-2",
    "border-spacing-x-1",
    "",
    undefined,
  ])("allows %s", (input) => expect(findClassNameProblem(input)).toBeUndefined());
});

describe("useAppearanceClassNameCheck", () => {
  it("does not warn for layout classes", async () => {
    await render(<Probe className="mt-4 w-full" />);
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn without a className", async () => {
    await render(<Probe />);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns, quoting the first offending token and the hint", async () => {
    await render(<Probe className="mt-4 bg-red-500 text-white" />);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('"bg-red-500"');
    expect(message).toContain('tone="destructive"');
    expect(message).toMatch(/^\[ouro-ui\] Button: .+\. Fix: .+\.$/);
  });

  it("points alignment classes to the alignHint, or to the parent", async () => {
    function AlignProbe({ alignHint }: { alignHint?: string }) {
      useAppearanceClassNameCheck("Button", "text-center", 'tone="destructive"', alignHint);
      return null;
    }
    await render(<AlignProbe alignHint='align="center"' />);
    expect(String(warn.mock.calls[0]?.[0])).toBe(
      '[ouro-ui] Button: "text-center" aligns content, and className is for layout only. Fix: align="center".',
    );
    await render(<AlignProbe />);
    expect(String(warn.mock.calls[1]?.[0])).toBe(
      '[ouro-ui] Button: "text-center" aligns content, and className is for layout only. Fix: <div className="text-center"><Button /></div>.',
    );
  });

  it("takes a hint function that picks the fix for the offending token", async () => {
    function HintProbe({ className }: { className: string }) {
      useAppearanceClassNameCheck("Text", className, (token) => (token === "text-sm" ? 'size="sm"' : 'tone="destructive"'));
      return null;
    }
    await render(<HintProbe className="mt-2 text-sm" />);
    await render(<HintProbe className="bg-red-500" />);
    expect(String(warn.mock.calls[0]?.[0])).toContain('Fix: size="sm".');
    expect(String(warn.mock.calls[1]?.[0])).toContain('Fix: tone="destructive".');
  });

  it("warns for dark: classes", async () => {
    await render(<Probe className="dark:bg-black" />);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warns once per instance, and again for another instance", async () => {
    const screen = await render(<Probe className="bg-red-500" />);
    await screen.rerender(<Probe className="bg-blue-500" />);
    expect(warn).toHaveBeenCalledTimes(1);
    await render(<Probe className="bg-red-500" />);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("warns when a later render adds an appearance class", async () => {
    const screen = await render(<Probe className="mt-4" />);
    expect(warn).not.toHaveBeenCalled();
    await screen.rerender(<Probe className="mt-4 rounded-full" />);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("never warns during server rendering", () => {
    renderToString(<Probe className="bg-red-500" />);
    expect(warn).not.toHaveBeenCalled();
  });
});
