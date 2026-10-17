import { useState, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, server, userEvent } from "vitest/browser";
import { Collapsible, type CollapsibleProps } from "~/components/ouro/collapsible/collapsible";
import { act } from "~/lib/ouro/testing/act";
import { pressTab } from "~/lib/ouro/testing/tab";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.padding = "24px";
  host.style.width = "420px";
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    rerender: (next: ReactNode) => act(async () => root.render(next)),
    get root() {
      return host.querySelector<HTMLElement>('[data-ouro="collapsible"]')!;
    },
    get trigger() {
      return host.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    },
    get panel() {
      return host.querySelector<HTMLElement>("[data-ouro-collapsible-panel]")!;
    },
  };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await commands.emulateMedia({ reducedMotion: "no-preference" });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

async function settled(element: Element) {
  await expect.poll(() => element.getAnimations({ subtree: true }).length).toBe(0);
}

const facts = <p>Calories 420, protein 18g</p>;

describe("Collapsible", () => {
  it("renders a closed disclosure button named by its title", async () => {
    const { root, trigger } = await render(<Collapsible title="Nutrition facts">{facts}</Collapsible>);
    expect(root.getAttribute("data-ouro")).toBe("collapsible");
    await expect.element(page.getByRole("button", { name: "Nutrition facts" })).toBeVisible();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // Closed, the panel stays mounted and hidden (until-found where supported), with no height.
    const panel = root.querySelector<HTMLElement>("[data-ouro-collapsible-panel]")!;
    expect(panel.hasAttribute("hidden")).toBe(true);
    expect(panel.getBoundingClientRect().height).toBe(0);
  });

  it("opens and closes on press, and calls onOpenChange", async () => {
    const onOpenChange = vi.fn();
    const { trigger } = await render(
      <Collapsible title="Nutrition facts" onOpenChange={onOpenChange}>
        {facts}
      </Collapsible>,
    );
    await userEvent.click(trigger);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await expect.element(page.getByText("Calories 420, protein 18g")).toBeVisible();
    await userEvent.click(trigger);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("starts open with defaultOpen and follows a controlled open", async () => {
    const first = await render(
      <Collapsible title="Nutrition facts" defaultOpen>
        {facts}
      </Collapsible>,
    );
    expect(first.trigger.getAttribute("aria-expanded")).toBe("true");
    function Controlled() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Collapsible title="Notes" open={open} onOpenChange={setOpen}>
            <p>Rest overnight</p>
          </Collapsible>
          <output>{String(open)}</output>
        </>
      );
    }
    const second = await render(<Controlled />);
    await userEvent.click(second.trigger);
    expect(second.host.querySelector("output")!.textContent).toBe("true");
  });

  it("animates the panel to its measured height, and not with reduced motion", async () => {
    const r = await render(<Collapsible title="Nutrition facts">{facts}</Collapsible>);
    const panel = r.panel;
    let heightStarted = false;
    const record = (event: TransitionEvent) => {
      if (event.target === panel && event.propertyName === "height") heightStarted = true;
    };
    panel.addEventListener("transitionrun", record);
    try {
      await userEvent.click(r.trigger);
      await expect.poll(() => heightStarted).toBe(true);
    } finally {
      panel.removeEventListener("transitionrun", record);
    }
    await settled(r.panel);
    expect(r.panel.getBoundingClientRect().height).toBeCloseTo(r.panel.scrollHeight, 0);
    await commands.emulateMedia({ reducedMotion: "reduce" });
    expect(getComputedStyle(r.panel).transitionProperty).not.toMatch(/height/);
  });

  it("rotates the chevron while open", async () => {
    const { trigger } = await render(
      <Collapsible title="Nutrition facts" defaultOpen>
        {facts}
      </Collapsible>,
    );
    await settled(trigger);
    expect(getComputedStyle(trigger.querySelector("svg")!).rotate).toBe("180deg");
  });

  it("toggles with the keyboard and shows a focus outline", async () => {
    const { trigger } = await render(<Collapsible title="Nutrition facts">{facts}</Collapsible>);
    await pressTab();
    expect(document.activeElement).toBe(trigger);
    expect(getComputedStyle(trigger).outlineStyle).toBe("solid");
    await userEvent.keyboard("{Enter}");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("can be disabled", async () => {
    const { trigger } = await render(
      <Collapsible title="Nutrition facts" disabled>
        {facts}
      </Collapsible>,
    );
    expect(trigger.disabled || trigger.getAttribute("aria-disabled") === "true").toBe(true);
  });

  it("gives the title a 44px row on a coarse pointer, or 36px otherwise", async () => {
    const { trigger } = await render(<Collapsible title="Nutrition facts">{facts}</Collapsible>);
    expect(trigger.getBoundingClientRect().height).toBeGreaterThanOrEqual(matchMedia("(pointer: coarse)").matches ? 44 : 36);
  });

  it("lets app layout classes win and forwards a ref to the root", async () => {
    let element: HTMLDivElement | null = null;
    const { root } = await render(
      <Collapsible title="Nutrition facts" className="mt-4" ref={(node) => void (element = node)}>
        {facts}
      </Collapsible>,
    );
    expect(getComputedStyle(root).marginTop).toBe("16px");
    expect(element).toBe(root);
  });

  it("lets the browser's page search find and open it, and hides it plainly where until-found is unsupported", async () => {
    const onOpenChange = vi.fn();
    const r = await render(
      <Collapsible title="Nutrition facts" onOpenChange={onOpenChange}>
        {facts}
      </Collapsible>,
    );
    expect(r.panel.textContent).toBe("Calories 420, protein 18g");
    const supported = "onbeforematch" in document.body;
    // Chromium has supported until-found since version 102, so there the check must take the first branch.
    if (server.browser === "chromium") expect(supported).toBe(true);
    if (supported) {
      expect(r.panel.getAttribute("hidden")).toBe("until-found");
      // What the browser fires when its page search matches hidden text.
      await act(async () => r.panel.dispatchEvent(new Event("beforematch", { bubbles: true })));
      await expect.poll(() => r.trigger.getAttribute("aria-expanded")).toBe("true");
      expect(onOpenChange).toHaveBeenLastCalledWith(true);
    } else {
      // Without until-found the browser would show the content, so the panel is plainly hidden.
      expect(r.panel.getAttribute("hidden")).toBe("");
      expect(r.panel.getBoundingClientRect().height).toBe(0);
    }
  });

  it("links the title and panel in server HTML and hydrates without a mismatch", async () => {
    const node = (
      <Collapsible title="Nutrition facts" defaultOpen>
        {facts}
      </Collapsible>
    );
    const html = renderToString(node);
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    mounted.push(host);
    const trigger = host.querySelector("button")!;
    expect(host.querySelector(`[id="${trigger.getAttribute("aria-controls")}"]`)).not.toBeNull();
    const recoverable = vi.fn();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(host, node, { onRecoverableError: recoverable });
    });
    roots.push(root);
    expect(recoverable).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    await userEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("Collapsible development messages", () => {
  it.each([
    ["trigger", { trigger: <button>Open</button> }, "trigger is not a prop", '<Collapsible title="Nutrition facts">'],
    ["label", { label: "Nutrition facts" }, "label is not a prop", '<Collapsible title="Nutrition facts">'],
    ["onChange", { onChange: () => {} }, "onChange is not a prop", "<Collapsible onOpenChange={(open) => …}>"],
    ["isOpen", { isOpen: true }, "isOpen is not a prop", "<Collapsible open>"],
  ])("warns for %s with the fix", async (_name, extra, problem, fix) => {
    const props = { title: "Nutrition facts", children: facts, ...extra } as unknown as CollapsibleProps;
    const { root } = await render(<Collapsible {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Collapsible: ${problem}. Fix: ${fix}.`);
    expect(root.hasAttribute("label")).toBe(false);
    expect(root.hasAttribute("isopen")).toBe(false);
  });

  it("checks the className", async () => {
    await render(
      <Collapsible title="Nutrition facts" className="rounded-lg">
        {facts}
      </Collapsible>,
    );
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] Collapsible: "rounded-lg" sets appearance, and className is for layout only. Fix: remove "rounded-lg"; Collapsible sets its own look.',
    );
  });

  it("renders to a string without warnings", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(
      <Collapsible title="Nutrition facts" className="bg-red-500">
        {facts}
      </Collapsible>,
    );
    expect(html).toContain('data-ouro="collapsible"');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
