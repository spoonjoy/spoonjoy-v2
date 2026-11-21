import { useState, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, server, userEvent } from "vitest/browser";
import { Collapsible, type CollapsibleProps } from "~/components/ouro/collapsible/collapsible";
import { watchLayoutReads } from "~/lib/ouro/testing/layout-reads";
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
  it("keeps its fixed sizes at a compact --spacing", async () => {
    const { host } = await render(<Collapsible title="Warm up">{facts}</Collapsible>);
    const chevron = () => getComputedStyle(host.querySelector<SVGElement>("svg")!);
    expect([chevron().width, chevron().height]).toEqual(["16px", "16px"]);
    host.style.setProperty("--spacing", "0.2rem");
    expect([chevron().width, chevron().height]).toEqual(["16px", "16px"]);
  });
  it("reads no style or layout when it mounts closed, however many there are", async () => {
    // The development theme check reads once per page; let it happen first.
    await render(<Collapsible title="Warm up">{facts}</Collapsible>);
    const watch = watchLayoutReads();
    try {
      await render(
        <>
          {Array.from({ length: 20 }, (_, i) => (
            <Collapsible key={i} title={`Section ${i}`}>
              {facts}
            </Collapsible>
          ))}
        </>,
      );
    } finally {
      watch.stop();
    }
    expect(watch.names()).toEqual([]);
  });

  it("keeps the trigger's edge under forced colours, which drop its fill", async () => {
    await commands.emulateMedia({ forcedColors: "active" });
    try {
      const { trigger } = await render(<Collapsible title="Nutrition facts">{facts}</Collapsible>);
      expect(parseFloat(getComputedStyle(trigger).borderTopWidth)).toBeGreaterThan(0);
      expect(getComputedStyle(trigger).borderTopStyle).toBe("solid");
    } finally {
      await commands.emulateMedia({ forcedColors: "none" });
    }
  });

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

  it("animates the panel open with a grid row, and not with reduced motion", async () => {
    const r = await render(<Collapsible title="Nutrition facts">{facts}</Collapsible>);
    const panel = r.panel;
    let heightStarted = false;
    const record = (event: TransitionEvent) => {
      if (event.target === panel && event.propertyName === "grid-template-rows") heightStarted = true;
    };
    panel.addEventListener("transitionrun", record);
    try {
      await userEvent.click(r.trigger);
      await expect.poll(() => heightStarted).toBe(true);
    } finally {
      panel.removeEventListener("transitionrun", record);
    }
    await settled(r.panel);
    expect(r.panel.getBoundingClientRect().height).toBeGreaterThan(20);
    await userEvent.click(r.trigger);
    await expect.poll(() => r.panel.hasAttribute("hidden")).toBe(true);
    await commands.emulateMedia({ reducedMotion: "reduce" });
    expect(getComputedStyle(r.panel).transitionProperty).not.toMatch(/grid-template-rows/);
    await userEvent.click(r.trigger);
    await userEvent.click(r.trigger);
    await expect.poll(() => r.panel.hasAttribute("hidden")).toBe(true);
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

  it("marks its state on the trigger and panel, hides again once closed, and ignores a page search after unmount", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const r = await render(
      <Collapsible title="Nutrition facts" open={false} onOpenChange={first}>
        {facts}
      </Collapsible>,
    );
    expect(r.trigger.hasAttribute("data-panel-open")).toBe(false);
    expect(r.trigger.hasAttribute("aria-controls")).toBe(false);
    expect(r.panel.hasAttribute("data-open")).toBe(false);
    expect(r.panel.hasAttribute("data-moved")).toBe(false);
    expect(r.panel.getAttribute("hidden")).not.toBeNull();
    // A later render's handler is the one a page search reaches.
    await r.rerender(
      <Collapsible title="Nutrition facts" open={false} onOpenChange={second}>
        {facts}
      </Collapsible>,
    );
    const panel = r.panel;
    await act(async () => panel.dispatchEvent(new Event("beforematch")));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(true);
    await r.rerender(
      <Collapsible title="Nutrition facts" open onOpenChange={second}>
        {facts}
      </Collapsible>,
    );
    expect(r.trigger.hasAttribute("data-panel-open")).toBe(true);
    expect(r.trigger.getAttribute("aria-controls")).toBe(r.panel.id);
    expect(r.panel.hasAttribute("data-open")).toBe(true);
    expect(r.panel.hasAttribute("data-moved")).toBe(true);
    expect(r.panel.hasAttribute("hidden")).toBe(false);
    await r.rerender(
      <Collapsible title="Nutrition facts" open={false} onOpenChange={second}>
        {facts}
      </Collapsible>,
    );
    await expect.poll(() => r.panel.hasAttribute("hidden")).toBe(true);
    if ("onbeforematch" in document.body) expect(r.panel.getAttribute("hidden")).toBe("until-found");
    // The panel stays shown while it closes, so the transition can run.
    await r.rerender(
      <Collapsible title="Nutrition facts" open onOpenChange={second}>
        {facts}
      </Collapsible>,
    );
    await settled(r.panel);
    // Read as the close starts, not after the rerender: on a loaded runner the rerender can outlast the transition.
    const closing = r.panel;
    let hiddenAsItCloses: boolean | undefined;
    const record = (event: TransitionEvent) => {
      if (event.target === closing && event.propertyName === "grid-template-rows" && hiddenAsItCloses === undefined) hiddenAsItCloses = closing.hasAttribute("hidden");
    };
    closing.addEventListener("transitionrun", record);
    try {
      await r.rerender(
        <Collapsible title="Nutrition facts" open={false} onOpenChange={second}>
          {facts}
        </Collapsible>,
      );
      await expect.poll(() => hiddenAsItCloses).toBe(false);
    } finally {
      closing.removeEventListener("transitionrun", record);
    }
    await expect.poll(() => r.panel.hasAttribute("hidden")).toBe(true);
    second.mockClear();
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    panel.dispatchEvent(new Event("beforematch"));
    expect(second).not.toHaveBeenCalled();
  });

  it("marks a disabled trigger", async () => {
    const r = await render(
      <Collapsible title="Nutrition facts" disabled>
        {facts}
      </Collapsible>,
    );
    expect(r.trigger.hasAttribute("data-disabled")).toBe(true);
    const plain = await render(<Collapsible title="Other">{facts}</Collapsible>);
    expect(plain.trigger.hasAttribute("data-disabled")).toBe(false);
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

describe("Collapsible's title width", () => {
  it("keeps the title button within its root, so a title that shortens does, and what follows it stays in view (#2501)", async () => {
    const long = "A very long team name that should shorten rather than push the count and chevron out of view";
    const view = await render(
      <div style={{ width: "300px" }}>
        <Collapsible
          title={
            <span className="flex min-w-0 flex-1">
              <span className="min-w-0 truncate">{long}</span>
              <span className="shrink-0" data-test-count="">
                3
              </span>
            </span>
          }
        >
          Members
        </Collapsible>
      </div>,
    );
    const root = view.root.getBoundingClientRect();
    const trigger = view.trigger.getBoundingClientRect();
    expect(trigger.width).toBeLessThanOrEqual(root.width);
    const count = view.host.querySelector("[data-test-count]")!.getBoundingClientRect();
    expect(count.right).toBeLessThanOrEqual(root.right);
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
      <Collapsible title="Nutrition facts" className="rounded-ouro-lg">
        {facts}
      </Collapsible>,
    );
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] Collapsible: "rounded-ouro-lg" sets appearance, and className is for layout only. Fix: remove "rounded-ouro-lg"; Collapsible sets its own look.',
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
