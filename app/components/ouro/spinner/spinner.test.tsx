import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";
import { Spinner, type SpinnerProps } from "~/components/ouro/spinner/spinner";
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
  return host.querySelector<HTMLElement>('[data-ouro="spinner"]')!;
}

function themeColor(variable: string): string {
  const probe = document.createElement("div");
  probe.style.color = `var(${variable})`;
  document.body.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
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
  await commands.emulateMedia({ reducedMotion: "no-preference" });
});

const warnings = () => warn.mock.calls.map((call: unknown[]) => String(call[0]));

describe("Spinner", () => {
  it("is a status with a hidden label, Loading by default, and a decorative icon", async () => {
    const spinner = await render(<Spinner />);
    expect(spinner.getAttribute("role")).toBe("status");
    expect(spinner.textContent).toBe("Loading");
    expect(spinner.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    const label = spinner.querySelector("span")!;
    expect(label.getBoundingClientRect().width).toBeLessThanOrEqual(1);
  });

  it("says what is loading with label", async () => {
    const spinner = await render(<Spinner label="Loading recipes" />);
    expect(spinner.textContent).toBe("Loading recipes");
  });

  it("sizes 16, 20 and 32px, md by default", async () => {
    const width = async (size?: SpinnerProps["size"]) => (await render(<Spinner size={size} />)).getBoundingClientRect().width;
    expect([await width("sm"), await width(), await width("md"), await width("lg")]).toEqual([16, 20, 20, 32]);
  });

  it("takes the text color by default, or a tone's color", async () => {
    const spinner = await render(
      <div style={{ color: "rgb(1, 2, 3)" }}>
        <Spinner />
      </div>,
    );
    expect(getComputedStyle(spinner).color).toBe("rgb(1, 2, 3)");
    for (const [tone, variable] of [
      ["primary", "--primary"],
      ["secondary", "--muted-foreground"],
      ["destructive", "--destructive"],
      ["success", "--success"],
      ["warning", "--warning"],
    ] as const) {
      expect(getComputedStyle(await render(<Spinner tone={tone} />)).color).toBe(themeColor(variable));
    }
  });

  it("spins, and pulses its opacity instead with reduced motion", async () => {
    const icon = (await render(<Spinner />)).querySelector("svg")!;
    expect(getComputedStyle(icon).animationName).toBe("ouro-spin");
    await commands.emulateMedia({ reducedMotion: "reduce" });
    expect(getComputedStyle(icon).animationName).toBe("ouro-pulse");
  });

  it("passes attributes through and keeps layout classes", async () => {
    const spinner = await render(<Spinner id="busy" data-testid="busy" className="ms-2" />);
    expect(spinner.id).toBe("busy");
    expect(spinner.getAttribute("data-testid")).toBe("busy");
    expect(spinner.classList.contains("ms-2")).toBe(true);
    expect(warnings()).toEqual([]);
  });

  it("renders on the server", () => {
    const html = renderToString(<Spinner label="Saving" />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Saving");
  });

  it("warns, once each, for an unknown size or tone, color, and appearance classes, and renders the defaults", async () => {
    const props = { size: "xl", tone: "danger", color: "red" } as unknown as SpinnerProps;
    const spinner = await render(<Spinner {...props} className="text-red-500" />);
    expect(spinner.getBoundingClientRect().width).toBe(20);
    expect(warnings()).toEqual([
      '[ouro-ui] Spinner: "text-red-500" sets appearance, and className is for layout only. Fix: tone="destructive".',
      '[ouro-ui] Spinner: size="xl" is not a size; use "sm", "md", "lg". Fix: <Spinner size="md">.',
      '[ouro-ui] Spinner: tone="danger" is not a tone. Fix: <Spinner tone="destructive">.',
      '[ouro-ui] Spinner: color is not a prop. Fix: <Spinner tone="destructive">.',
    ]);
    await render(<Spinner className="size-12" />);
    expect(warnings()).toHaveLength(4);
    await render(<Spinner className="text-lg" />);
    expect(warnings().at(-1)).toBe('[ouro-ui] Spinner: "text-lg" sets appearance, and className is for layout only. Fix: size="sm", size="md" or size="lg".');
  });
});
