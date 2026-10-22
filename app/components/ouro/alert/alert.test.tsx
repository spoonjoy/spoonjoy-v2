import { useState, type ReactNode, type SVGProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
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

  it("renders an action below the description", async () => {
    const retry = vi.fn();
    const { alert } = await render(
      <Alert
        tone="destructive"
        title="Couldn't save"
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
            <Alert tone="destructive" title="Couldn't save" action={<Button size="sm" onClick={() => setFailed(false)}>Try again</Button>} />
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
