import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Separator } from "~/components/ouro/separator/separator";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    get separator() {
      return host.querySelector<HTMLElement>('[data-ouro="separator"]')!;
    },
  };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

describe("Separator", () => {
  it("is a horizontal separator a pixel high in the border color", async () => {
    const { separator } = await render(
      <div style={{ width: 200 }}>
        <Separator />
      </div>,
    );
    expect(separator.getAttribute("role")).toBe("separator");
    expect(separator.getAttribute("aria-orientation")).toBe("horizontal");
    expect(separator.getAttribute("data-orientation")).toBe("horizontal");
    const rect = separator.getBoundingClientRect();
    expect(rect.height).toBe(1);
    expect(rect.width).toBe(200);
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--border)";
    document.body.append(probe);
    mounted.push(probe);
    expect(getComputedStyle(separator).backgroundColor).toBe(getComputedStyle(probe).backgroundColor);
  });

  it("stands as tall as its row when vertical", async () => {
    const { separator } = await render(
      <div style={{ display: "flex", height: 40 }}>
        <span>Edit</span>
        <Separator orientation="vertical" />
        <span>Share</span>
      </div>,
    );
    expect(separator.getAttribute("aria-orientation")).toBe("vertical");
    const rect = separator.getBoundingClientRect();
    expect(rect.width).toBe(1);
    expect(rect.height).toBe(40);
  });

  it("is hidden from assistive technology when decorative", async () => {
    const { separator } = await render(<Separator decorative />);
    expect(separator.getAttribute("role")).toBe("none");
    expect(separator.hasAttribute("aria-orientation")).toBe(false);
  });

  it("forwards a ref and lets app layout classes win", async () => {
    let element: HTMLDivElement | null = null;
    const { separator } = await render(<Separator className="my-4" ref={(node) => void (element = node)} />);
    expect(element).toBe(separator);
    expect(getComputedStyle(separator).marginTop).toBe("16px");
  });
});

describe("Separator development messages", () => {
  it.each([
    ["vertical", { vertical: true }, "vertical is not a prop", '<Separator orientation="vertical" />'],
    ["orientation", { orientation: "column" }, 'orientation="column" is not an orientation; use "horizontal", "vertical"', '<Separator orientation="vertical" />'],
    ["orientation", { orientation: "row" }, 'orientation="row" is not an orientation; use "horizontal", "vertical"', '<Separator orientation="horizontal" />'],
    ["children", { children: "or" }, "Separator takes no children", '<div className="flex items-center gap-3"><Separator className="flex-1" /><Text>or</Text><Separator className="flex-1" /></div>'],
  ])("warns for %s with the fix", async (_name, extra, problem, fix) => {
    const props = { ...extra } as unknown as Parameters<typeof Separator>[0];
    const { separator } = await render(<Separator {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Separator: ${problem}. Fix: ${fix}.`);
    expect(separator.hasAttribute("vertical")).toBe(false);
    expect(separator.textContent).toBe("");
  });

  it("renders horizontal for an unknown orientation", async () => {
    const props = { orientation: "diagonal" } as unknown as Parameters<typeof Separator>[0];
    const { separator } = await render(<Separator {...props} />);
    expect(separator.getAttribute("aria-orientation")).toBe("horizontal");
  });

  it.each([
    ["bg-red-500", 'remove "bg-red-500"; Separator uses the theme\'s --border color'],
    ["border-t", 'remove "border-t"; Separator uses the theme\'s --border color'],
    ["w-1/2", ""],
  ])("checks the className %s", async (className, fix) => {
    await render(<Separator className={className} />);
    if (fix) {
      expect(warn).toHaveBeenCalledWith(`[ouro-ui] Separator: "${className}" sets appearance, and className is for layout only. Fix: ${fix}.`);
    } else {
      expect(warn).not.toHaveBeenCalled();
    }
  });

  it("renders to a string without warnings", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(<Separator orientation="vertical" className="bg-red-500" />);
    expect(html).toContain('data-ouro="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
