import { useState, type ReactNode, type SVGProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Alert } from "~/components/ouro/alert/alert";
import { Button } from "~/components/ouro/button/button";
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
    get alert() {
      return host.querySelector<HTMLElement>('[data-ouro="alert"]')!;
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

describe("Alert", () => {
  it("keeps its fixed sizes at a compact --spacing: the tone icon at 20px and the dismiss icon at 16px", async () => {
    const { host, alert } = await render(<Alert title="Saved" onDismiss={() => {}} />);
    const sizes = () => [alert.querySelector("[data-ouro-alert-icon]"), alert.querySelector("button svg")].map((svg) => parseFloat(getComputedStyle(svg!).width));
    expect(sizes()).toEqual([expect.closeTo(20), expect.closeTo(16)]);
    host.style.setProperty("--spacing", "0.2rem");
    expect(sizes()).toEqual([expect.closeTo(20), expect.closeTo(16)]);
  });
  it("renders the title and description in a status region by default", async () => {
    const { alert } = await render(<Alert title="Recipe saved" description="It's in your cookbook now." />);
    expect(alert.getAttribute("role")).toBe("status");
    expect(alert.getAttribute("data-tone")).toBe("secondary");
    await expect.element(page.getByRole("status")).toHaveTextContent("Recipe savedIt's in your cookbook now.");
    expect(alert.querySelector("[data-ouro-alert-icon]")!.getAttribute("aria-hidden")).toBe("true");
  });

  it.each([
    ["destructive", "alert"],
    ["warning", "alert"],
    ["primary", "status"],
    ["secondary", "status"],
    ["success", "status"],
  ] as const)("uses role=%s for a %s alert", async (tone, role) => {
    const { alert } = await render(<Alert tone={tone} title="Heads up" />);
    expect(alert.getAttribute("role")).toBe(role);
  });

  it("wraps a long word in its title and description inside its box, as an address in an error is", async () => {
    const address = "https://api.example.com/v1/recipes/rcp_lemon_orzo/ingredients?include=substitutions";
    const { host, alert } = await render(<Alert tone="destructive" title={`Couldn't reach ${address}`} description={`Tried ${address} three times.`} />);
    host.style.width = "240px";
    const box = alert.getBoundingClientRect();
    for (const part of alert.querySelectorAll<HTMLElement>("[data-ouro-alert-title], [data-ouro-alert-description]")) {
      expect(part.scrollWidth).toBeLessThanOrEqual(part.clientWidth);
      expect(part.getBoundingClientRect().right).toBeLessThanOrEqual(box.right);
    }
  });

  it("gives every tone a distinct look", async () => {
    const tones = ["primary", "secondary", "destructive", "success", "warning"] as const;
    const { host } = await render(
      <>
        {tones.map((tone) => (
          <Alert key={tone} tone={tone} title={tone} />
        ))}
      </>,
    );
    const looks = [...host.querySelectorAll<HTMLElement>('[data-ouro="alert"]')].map((alert) => {
      const style = getComputedStyle(alert);
      return `${style.backgroundColor}|${style.borderColor}`;
    });
    expect(new Set(looks).size).toBe(tones.length);
  });

  it("uses a surface instead of a border, and keeps an edge in forced colours", async () => {
    const tones = ["primary", "secondary", "destructive", "success", "warning"] as const;
    const { host } = await render(<>{tones.map((tone) => <Alert key={tone} tone={tone} title={tone} />)}</>);
    const alerts = [...host.querySelectorAll<HTMLElement>('[data-ouro="alert"]')];
    for (const alert of alerts) expect(getComputedStyle(alert).borderTopWidth).toBe("0px");
    try {
      await commands.emulateMedia({ forcedColors: "active" });
      for (const alert of alerts) {
        expect(getComputedStyle(alert).outlineStyle).toBe("solid");
        expect(parseFloat(getComputedStyle(alert).outlineWidth)).toBeGreaterThanOrEqual(1);
      }
    } finally {
      await commands.emulateMedia({ forcedColors: "none" });
    }
  });

  it("renders an action below the description", async () => {
    const retry = vi.fn();
    const { alert } = await render(
      <Alert
        tone="destructive"
        title="Not saved: you're offline"
        description="Check your connection."
        action={
          <Button size="sm" onClick={retry}>
            Try again
          </Button>
        }
      />,
    );
    await userEvent.click(page.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    const description = alert.querySelector("[data-ouro-alert-description]")!;
    const action = alert.querySelector("[data-ouro-alert-action]")!;
    expect(action.getBoundingClientRect().top).toBeGreaterThanOrEqual(description.getBoundingClientRect().bottom);
  });

  it("keeps a title alone, or a title with a description and an action, in a column", async () => {
    const alone = await render(<Alert title="Saved" />);
    const body = alone.alert.querySelector("[data-slot='alert-body']")!.getBoundingClientRect();
    // The body is the title's line and no more: no foot kept for an action that overhangs.
    expect(body.height).toBeCloseTo(alone.alert.querySelector("[data-ouro-alert-title]")!.getBoundingClientRect().height, 0);
    const full = await render(
      <div style={{ width: "900px" }}>
        <Alert title="Not saved" description="Check your connection." action={<Button size="sm">Try again</Button>} />
      </div>,
    );
    const title = full.alert.querySelector("[data-ouro-alert-title]")!.getBoundingClientRect();
    const description = full.alert.querySelector("[data-ouro-alert-description]")!.getBoundingClientRect();
    const action = full.alert.querySelector("[data-ouro-alert-action]")!.getBoundingClientRect();
    expect(description.top).toBeGreaterThanOrEqual(title.bottom);
    expect(action.top).toBeGreaterThanOrEqual(description.bottom);
  });

  it("puts an action beside a title with no description where they fit, and under it where they don't", async () => {
    const band = (width: string) => (
      <div style={{ width }}>
        <Alert
          tone="warning"
          title="2 need your answer"
          action={
            <>
              <Button size="sm">Design review</Button>
              <Button size="sm">Planning</Button>
            </>
          }
        />
      </div>
    );
    const wide = await render(band("900px"));
    const title = () => wide.alert.querySelector("[data-ouro-alert-title]")!.getBoundingClientRect();
    const action = () => wide.alert.querySelector("[data-ouro-alert-action]")!.getBoundingClientRect();
    expect(action().left).toBeGreaterThanOrEqual(title().right);
    // On one line, level: the title, its buttons and the icon share a middle.
    const middle = (box: DOMRect) => box.top + box.height / 2;
    const button = wide.alert.querySelector("[data-ouro-alert-action] button")!.getBoundingClientRect();
    const icon = wide.alert.querySelector("[data-ouro-alert-icon]")!.getBoundingClientRect();
    expect(Math.abs(middle(button) - middle(title()))).toBeLessThanOrEqual(1);
    expect(Math.abs(middle(icon) - middle(title()))).toBeLessThanOrEqual(1);
    const narrow = await render(band("260px"));
    const narrowTitle = narrow.alert.querySelector("[data-ouro-alert-title]")!;
    // The title keeps its whole line, unbroken, and the action goes under it.
    expect(narrowTitle.getBoundingClientRect().height).toBeLessThan(30);
    const wrapped = narrow.alert.querySelector("[data-ouro-alert-action] button")!.getBoundingClientRect();
    expect(wrapped.top - narrowTitle.getBoundingClientRect().bottom).toBeCloseTo(12, 0);
    const last = [...narrow.alert.querySelectorAll("[data-ouro-alert-action] button")].at(-1)!.getBoundingClientRect();
    // The padding under the last button is the same as without the overhang.
    expect(narrow.alert.getBoundingClientRect().bottom - last.bottom).toBeCloseTo(16, 0);
  });

  it("lets an action beside its title shrink, so a row of buttons in it scrolls inside the alert", async () => {
    const { alert } = await render(
      <div style={{ width: "420px" }}>
        <Alert
          tone="warning"
          title="4 need your answer"
          action={
            <div data-testid="strip" style={{ display: "flex", flexWrap: "nowrap", overflowX: "auto", gap: "8px" }}>
              {["Design review", "Planning", "Architecture forum", "Quarterly review"].map((name) => (
                <Button key={name} size="sm" style={{ flex: "none" }}>
                  {name}
                </Button>
              ))}
            </div>
          }
        />
      </div>,
    );
    const strip = alert.querySelector<HTMLElement>("[data-testid='strip']")!;
    const body = alert.querySelector("[data-slot='alert-body']")!.getBoundingClientRect();
    expect(alert.querySelector("[data-ouro-alert-action]")!.getBoundingClientRect().right).toBeLessThanOrEqual(body.right + 0.5);
    expect(strip.scrollWidth).toBeGreaterThan(strip.clientWidth);
  });

  it("shows a dismiss button with onDismiss, named by dismissLabel", async () => {
    const onDismiss = vi.fn();
    await render(<Alert title="Saved" onDismiss={onDismiss} />);
    await userEvent.click(page.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await render(<Alert title="Guardado" onDismiss={onDismiss} dismissLabel="Cerrar" />);
    await expect.element(page.getByRole("button", { name: "Cerrar" })).toBeVisible();
  });

  it.each([
    ["the next control after it", true, "Next"],
    ["the control before it when nothing follows", false, "Before"],
  ])("moves focus to %s when it is dismissed and removed", async (_name, withNext, target) => {
    function Page() {
      const [open, setOpen] = useState(true);
      return (
        <div>
          <button type="button">Before</button>
          {open && <Alert title="Saved" onDismiss={() => setOpen(false)} />}
          {withNext && <button type="button">Next</button>}
        </div>
      );
    }
    await render(<Page />);
    const dismiss = page.getByRole("button", { name: "Dismiss" });
    await userEvent.click(dismiss);
    await expect.poll(() => document.activeElement?.textContent).toBe(target);
  });

  it("hands focus to what replaces it when its action removes it", async () => {
    function Retry() {
      const [failed, setFailed] = useState(true);
      return (
        <div>
          {failed ? (
            <Alert tone="destructive" title="Not saved: you're offline" action={<Button size="sm" onClick={() => setFailed(false)}>Try again</Button>} />
          ) : (
            <Button onClick={() => setFailed(true)}>Show the error again</Button>
          )}
        </div>
      );
    }
    await render(<Retry />);
    (page.getByRole("button", { name: "Try again" }).element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => document.activeElement?.textContent).toBe("Show the error again");
  });

  it("lets focus fall back to the page when nothing else can take it", async () => {
    function Lone() {
      const [open, setOpen] = useState(true);
      return open ? <Alert title="Saved" onDismiss={() => setOpen(false)} /> : <p>Gone</p>;
    }
    await render(<Lone />);
    await userEvent.click(page.getByRole("button", { name: "Dismiss" }));
    await expect.element(page.getByText("Gone")).toBeVisible();
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    expect(document.activeElement).toBe(document.body);
  });

  it("leaves focus alone when the app keeps the alert after dismiss", async () => {
    const onDismiss = vi.fn();
    await render(
      <div>
        <Alert title="Saved" onDismiss={onDismiss} />
        <button type="button">Next</button>
      </div>,
    );
    const dismiss = page.getByRole("button", { name: "Dismiss" });
    await userEvent.click(dismiss);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Dismiss");
  });

  it("has no dismiss button without onDismiss", async () => {
    const { alert } = await render(<Alert title="Saved" />);
    expect(alert.querySelector("button")).toBeNull();
  });

  it("takes an icon component, or none", async () => {
    const Icon = (props: SVGProps<SVGSVGElement>) => <svg data-custom="" {...props} />;
    const { host } = await render(
      <>
        <Alert title="Custom" icon={Icon} />
        <Alert title="None" icon={null} />
      </>,
    );
    const [custom, none] = [...host.querySelectorAll('[data-ouro="alert"]')];
    expect(custom!.querySelector("[data-custom]")!.getAttribute("aria-hidden")).toBe("true");
    expect(none!.querySelector("svg")).toBeNull();
  });

  it("forwards a ref and lets app layout classes win", async () => {
    let element: HTMLDivElement | null = null;
    const { alert } = await render(<Alert title="Saved" className="mt-4" ref={(node) => void (element = node)} />);
    expect(element).toBe(alert);
    expect(getComputedStyle(alert).marginTop).toBe("16px");
  });
});

describe("Alert development messages", () => {
  it.each([
    ["shadcn's variant", { variant: "destructive" }, 'variant="destructive" is not a prop', '<Alert tone="destructive">'],
    ["shadcn's default variant", { variant: "default" }, 'variant="default" is not a prop', '<Alert tone="secondary">'],
    ["MUI's warning severity", { severity: "warning" }, "severity is not a prop", '<Alert tone="warning">'],
    ["Chakra's success status", { status: "success" }, "status is not a prop", '<Alert tone="success">'],
    ["an error tone", { tone: "error" }, 'tone="error" is not a tone; use "primary", "secondary", "destructive", "success", "warning"', '<Alert tone="destructive">'],
    ["MUI's severity", { severity: "error" }, "severity is not a prop", '<Alert tone="destructive">'],
    ["Chakra's status", { status: "info" }, "status is not a prop", '<Alert tone="primary">'],
    ["onClose", { onClose: () => {} }, "onClose is not a prop", "<Alert onDismiss={() => setOpen(false)}>"],
    ["children", { children: "Body" }, "Alert takes no children", '<Alert title="…" description="…">'],
    ["a danger tone", { tone: "danger" }, 'tone="danger" is not a tone', '<Alert tone="destructive">'],
    ["an info tone", { tone: "info" }, 'tone="info" is not a tone; use "primary", "secondary", "destructive", "success", "warning"', '<Alert tone="primary">'],
  ])("warns for %s with the fix", async (_name, extra, problem, fix) => {
    const props = { title: "Saved", ...extra } as unknown as Parameters<typeof Alert>[0];
    const { alert } = await render(<Alert {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Alert: ${problem}. Fix: ${fix}.`);
    expect(alert.hasAttribute("severity")).toBe(false);
    expect(alert.hasAttribute("variant")).toBe(false);
    expect(alert.textContent).not.toContain("Body");
  });

  it("renders the secondary tone for an unknown tone", async () => {
    const props = { tone: "info", title: "Saved" } as unknown as Parameters<typeof Alert>[0];
    const { alert } = await render(<Alert {...props} />);
    expect(alert.getAttribute("data-tone")).toBe("secondary");
    expect(alert.getAttribute("role")).toBe("status");
  });

  it.each([
    ["bg-red-50", 'tone="destructive"'],
    ["text-sm", 'remove "text-sm"; Alert sets its own size'],
    ["font-semibold", 'remove "font-semibold"; Alert sets its own weight'],
    ["mt-4", ""],
  ])("checks the className %s", async (className, fix) => {
    await render(<Alert title="Saved" className={className} />);
    if (fix) {
      expect(warn).toHaveBeenCalledWith(`[ouro-ui] Alert: "${className}" sets appearance, and className is for layout only. Fix: ${fix}.`);
    } else {
      expect(warn).not.toHaveBeenCalled();
    }
  });

  it("renders to a string without warnings", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(<Alert tone="warning" title="Low stock" description="Two jars left." className="bg-red-50" onDismiss={() => {}} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Two jars left.");
    expect(html).toContain('aria-label="Dismiss"');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
