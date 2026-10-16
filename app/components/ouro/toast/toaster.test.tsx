import { StrictMode, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, server, userEvent } from "vitest/browser";
import { Toaster, type ToasterProps } from "~/components/ouro/toast/toaster";
import { toast, type ToastOptions } from "~/lib/ouro/toast";
import { springAt } from "~/lib/ouro/spring";
import { act } from "~/lib/ouro/testing/act";
import { pressTab } from "~/lib/ouro/testing/tab";
import { holdFrames } from "~/lib/ouro/testing/frames";

const chromiumOnly = it.skipIf(server.browser !== "chromium");

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return { host, root, unmount: () => act(async () => root.unmount()) };
}

const viewport = () => document.querySelector<HTMLElement>('[data-ouro="toaster"]');
const toasts = () => [...document.querySelectorAll<HTMLElement>('[data-ouro="toast"]')];
const toastNamed = (message: string) => toasts().find((item) => item.querySelector("[data-ouro-toast-title]")?.textContent === message);
const showing = (message: string) => {
  const item = toastNamed(message);
  return Boolean(item && !item.hasAttribute("data-ending-style"));
};

/** Shows a toast inside act, so React commits it. */
async function show(message: string, options?: ToastOptions) {
  await act(async () => {
    toast(message, options);
  });
  await expect.poll(() => showing(message)).toBe(true);
  const item = toastNamed(message)!;
  // Wait for it to finish sliding in, so a pointer lands where the test measured.
  await expect.poll(() => item.getAnimations().length).toBe(0);
  return item;
}

/** The toasts' messages, in page order. */
const titles = () => toasts().map((item) => item.querySelector("[data-ouro-toast-title]")!.textContent);

/** Records the text each live region exposes as it changes; text inside aria-hidden is not exposed. */
function watchAnnouncements() {
  const liveSelector = '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]';
  const changes: Array<{ region: Element; text: string }> = [];
  const exposed = (node: Node) => {
    const element = node instanceof Element ? node : node.parentElement;
    return !element?.closest('[aria-hidden="true"]');
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      const nodes = record.type === "characterData" ? [record.target] : [...record.addedNodes];
      for (const node of nodes) {
        // Text added inside a live region, or a live region added with its text.
        const region = target?.closest(liveSelector) ?? (node instanceof Element ? (node.matches(liveSelector) ? node : node.querySelector(liveSelector)) : null);
        const text = exposed(node) ? (node.textContent ?? "") : "";
        if (region && text) changes.push({ region, text });
      }
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  const matching = (message: string) => changes.filter((change) => change.text.includes(message));
  return { changes, matching, count: (message: string) => matching(message).length, stop: () => observer.disconnect() };
}

/** Waits until the toast is gone from the page. */
const gone = (message: string) => expect.poll(() => toastNamed(message)).toBeUndefined();

/** Polls until `ms` milliseconds have passed: a condition, so a loaded runner just waits longer. */
async function elapse(ms: number) {
  const start = performance.now();
  await expect.poll(() => performance.now() - start >= ms).toBe(true);
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  // A pointer left where an earlier test pressed a toast would hover new ones and pause them.
  await moveMouseAway();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

/** Moves the pointer to the top corner of the page, away from the toasts. */
async function moveMouseAway() {
  const corner = document.createElement("div");
  Object.assign(corner.style, { position: "fixed", top: "0", left: "0", width: "8px", height: "8px" });
  document.body.append(corner);
  await userEvent.hover(corner);
  corner.remove();
}
afterEach(async () => {
  await act(async () => toast.dismiss());
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
  await page.viewport(414, 896);
  await commands.emulateMedia({ reducedMotion: "no-preference" });
});

const warnings = () => warn.mock.calls.map((call: unknown[]) => String(call[0]));

describe("Toaster", () => {
  // Prospective cast lets the RED browser run reach unchanged pre-className runtime.
  // toaster.test-d.ts independently checks the real public API without a cast.
  const layoutProps = (className: string) => ({ className }) as unknown as ToasterProps;

  it("lets unprefixed app clearance and width win on the actual viewport at phone and desktop widths", async () => {
    const { root } = await render(<Toaster />);
    for (const width of [414, 639, 640, 1024]) {
      await page.viewport(width, 896);
      for (const className of ["bottom-20", "w-80", "bottom-20 w-80"]) {
        await act(async () => root.render(<Toaster {...layoutProps(className)} />));
        const region = viewport()!;
        const css = getComputedStyle(region);
        const rect = region.getBoundingClientRect();
        if (className.includes("bottom-20")) {
          expect(css.bottom).toBe("80px");
          expect(896 - rect.bottom).toBeCloseTo(80, 1);
        }
        if (className.includes("w-80")) expect(rect.width).toBeCloseTo(320, 1);
        expect(region.className).toContain(className);
        expect(region.parentElement!.className).not.toContain(className);
      }
    }
    expect(warnings()).toEqual([]);
  });

  async function checkDefaultGeometry(onMutated?: () => void) {
    const { root } = await render(<Toaster />);
    const region = viewport()!;
    const html = document.documentElement;
    const oldDir = html.getAttribute("dir");
    const oldSpacing = { value: html.style.getPropertyValue("--spacing"), priority: html.style.getPropertyPriority("--spacing") };
    try {
      for (const spacing of ["0.25rem", "0.3rem"]) {
        html.style.setProperty("--spacing", spacing, oldSpacing.priority);
        const unit = spacing === "0.25rem" ? 4 : 4.8;
        for (const dir of ["ltr", "rtl"]) {
          html.setAttribute("dir", dir);
          onMutated?.();
          for (const width of [414, 639, 640, 1024]) {
            await page.viewport(width, 896);
            await act(async () => root.render(<Toaster />));
            const rect = region.getBoundingClientRect();
            const css = getComputedStyle(region);
            const desktop = width >= 640;
            expect(parseFloat(css.bottom)).toBeCloseTo(desktop ? 6 * unit : 16, 1);
            expect(rect.width).toBeCloseTo(desktop ? 90 * unit : width - 8 * unit, 1);
            expect(dir === "rtl" && desktop ? rect.left : width - rect.right).toBeCloseTo(desktop ? 6 * unit : 4 * unit, 1);
            // Phone bottom is max(1rem, env(safe-area-inset-bottom)), not spacing(4).
            const safeArea = document.createElement("div");
            safeArea.style.bottom = "max(1rem, env(safe-area-inset-bottom))";
            document.body.append(safeArea);
            try {
              if (!desktop) expect(css.bottom).toBe(getComputedStyle(safeArea).bottom);
            } finally {
              safeArea.remove();
            }
          }
        }
      }
    } finally {
      if (oldDir === null) html.removeAttribute("dir");
      else html.setAttribute("dir", oldDir);
      if (oldSpacing.value) html.style.setProperty("--spacing", oldSpacing.value, oldSpacing.priority);
      else html.style.removeProperty("--spacing");
    }
  }

  it("preserves logical default geometry across sm, RTL and a nonstandard spacing scale", async () => {
    await checkDefaultGeometry();
  });

  it("updates viewport layout without replacing or reannouncing a live toast or resetting its countdown", async () => {
    const announced = watchAnnouncements();
    try {
      const { root } = await render(<Toaster {...layoutProps("bottom-20")} />);
      const region = viewport()!;
      // Control the countdown's Date/setTimeout clock, not animation frames or
      // polling. Real host round trips may outlive a finite toast on busy WebKit.
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      await act(async () => { toast("Layout survives", { duration: 2400 }); });
      const item = toastNamed("Layout survives")!;
      expect(item).toBeDefined();
      const count = announced.count("Layout survives");
      expect(count).toBe(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1400); });
      await act(async () => root.render(<Toaster {...layoutProps("bottom-24 w-80")} />));
      expect(viewport()).toBe(region);
      expect(toastNamed("Layout survives")).toBe(item);
      expect(getComputedStyle(region).bottom).toBe("96px");
      expect(announced.count("Layout survives")).toBe(count);
      expect(document.querySelectorAll('[data-ouro="toaster"]')).toHaveLength(1);
      // Exact original deadline: neither an early close nor a reset is allowed.
      await act(async () => { await vi.advanceTimersByTimeAsync(999); });
      expect(showing("Layout survives")).toBe(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(showing("Layout survives")).toBe(false);
    } finally {
      vi.useRealTimers();
      announced.stop();
    }
  });

  async function checkNamedGeometry(onMutated?: () => void) {
    const style = document.documentElement.style;
    const tokens = ["--spacing-4", "--spacing-6", "--spacing-90"];
    const before = tokens.map((token) => ({ value: style.getPropertyValue(token), priority: style.getPropertyPriority(token) }));
    try {
      style.setProperty("--spacing-4", "18px", before[0]!.priority);
      style.setProperty("--spacing-6", "28px", before[1]!.priority);
      style.setProperty("--spacing-90", "400px", before[2]!.priority);
      onMutated?.();
      await render(<Toaster />);
      await page.viewport(414, 896);
      expect(viewport()!.getBoundingClientRect().width).toBeCloseTo(378, 1);
      expect(viewport()!.getBoundingClientRect().left).toBeCloseTo(18, 1);
      expect(getComputedStyle(viewport()!).bottom).toBe("16px");
      await page.viewport(1024, 896);
      const rect = viewport()!.getBoundingClientRect();
      expect(rect.width).toBeCloseTo(400, 1);
      const rtl = getComputedStyle(viewport()!).direction === "rtl";
      expect(rtl ? rect.left : 1024 - rect.right).toBeCloseTo(28, 1);
      expect(getComputedStyle(viewport()!).bottom).toBe("28px");
    } finally {
      tokens.forEach((token, index) => {
        if (before[index]!.value) style.setProperty(token, before[index]!.value, before[index]!.priority);
        else style.removeProperty(token);
      });
    }
  }

  it("keeps named spacing-scale values on the viewport as well as the universal spacing fallback", async () => {
    await checkNamedGeometry();
  });

  const ambientCases = (["default", "named"] as const).flatMap((kind) =>
    ([null, "", "rtl"] as const).flatMap((dir) =>
      [false, true].map((fail) => ({ kind, dir, dirLabel: dir === null ? "absent" : dir === "" ? "empty" : dir, fail })),
    ),
  );
  it.each(ambientCases)("preserves ambient state for $kind / $dirLabel / thrown=$fail", async ({ kind, dir, fail }) => {
    const html = document.documentElement;
    const ambientDir = html.getAttribute("dir");
    const ambientCss = html.style.cssText;
    const properties = kind === "default" ? ["--spacing"] : ["--spacing-4", "--spacing-6", "--spacing-90"];
    try {
      if (dir === null) html.removeAttribute("dir");
      else html.setAttribute("dir", dir);
      properties.forEach((property, index) => html.style.setProperty(property, kind === "default" ? "0.23rem" : `${19 + index}px`, "important"));
      const expected = properties.map((property) => [html.style.getPropertyValue(property), html.style.getPropertyPriority(property)]);
      const check = kind === "default" ? checkDefaultGeometry : checkNamedGeometry;
      const failure = new Error("ambient-state control");
      if (fail) await expect(check(() => { throw failure; })).rejects.toBe(failure);
      else await check();
      expect(html.hasAttribute("dir")).toBe(dir !== null);
      expect(html.getAttribute("dir")).toBe(dir);
      properties.forEach((property, index) => {
        expect([html.style.getPropertyValue(property), html.style.getPropertyPriority(property)]).toEqual(expected[index]);
      });
    } finally {
      if (ambientDir === null) html.removeAttribute("dir");
      else html.setAttribute("dir", ambientDir);
      html.style.cssText = ambientCss;
    }
  });

  it.each([
    ["bg-red-500", "sets appearance", ":root { --popover"],
    ["text-center", "aligns content", "Toaster owns toast-content alignment; use <Toaster /> without the alignment class"],
  ])("warns once after hydration for %s without recommending a portal wrapper", async (className, problem, hint) => {
    const props = layoutProps(className);
    const host = document.createElement("div");
    host.innerHTML = renderToString(<Toaster {...props} />);
    expect(host.innerHTML).toBe("");
    expect(warnings()).toEqual([]);
    document.body.append(host);
    mounted.push(host);
    let root!: Root;
    await act(async () => { root = hydrateRoot(host, <Toaster {...props} />); });
    roots.push(root);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain(problem);
    expect(warnings()[0]).toContain(hint);
    expect(warnings()[0]).not.toContain("<div");
    await act(async () => root.render(<Toaster {...props} />));
    expect(warnings()).toHaveLength(1);
  });

  it("renders an empty, polite Notifications region in a portal", async () => {
    const { host } = await render(<Toaster />);
    const region = viewport()!;
    expect(region).not.toBeNull();
    expect(host.contains(region)).toBe(false);
    expect(region.getAttribute("role")).toBe("region");
    expect(region.getAttribute("aria-label")).toBe("Notifications");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(toasts()).toEqual([]);
  });

  it("translates the region name and the dismiss button with label and closeLabel", async () => {
    await render(<Toaster label="Benachrichtigungen" closeLabel="Schließen" />);
    expect(viewport()!.getAttribute("aria-label")).toBe("Benachrichtigungen");
    const item = await show("Gespeichert");
    expect(item.querySelector('button[aria-label="Schließen"]')).not.toBeNull();
  });

  it("stacks above dialogs and sheets, one level over --ouro-layer", async () => {
    await render(<Toaster />);
    const portal = viewport()!.parentElement!;
    // --ouro-layer is 50 from ouro-base, unless the app raised it.
    const layer = Number(getComputedStyle(document.documentElement).getPropertyValue("--ouro-layer"));
    expect(layer).toBeGreaterThanOrEqual(50);
    expect(getComputedStyle(portal).zIndex).toBe(String(layer + 1));
    expect(getComputedStyle(portal).isolation).toBe("isolate");
  });

  it("renders nothing on the server", () => {
    expect(renderToString(<Toaster />)).toBe("");
  });

  it("warns once for Sonner's props, with the fix", async () => {
    const props = { position: "top-center", richColors: true, theme: "dark", duration: 3000 } as unknown as ToasterProps;
    await render(<Toaster {...props} />);
    expect(warnings()).toEqual([
      "[ouro-ui] Toaster: position is not a prop; toasts show at the bottom, full width on phones. Fix: <Toaster />.",
      '[ouro-ui] Toaster: richColors is not a prop. Fix: toast("Saved", { tone: "success" }).',
      "[ouro-ui] Toaster: theme is not a prop; dark mode follows the .dark class. Fix: <Toaster />.",
      '[ouro-ui] Toaster: duration is not a prop. Fix: toast("Saved", { duration: 3000 }).',
    ]);
  });

  it("shows toasts in one Toaster only, warns when a second is rendered, and lets the second take over when the first unmounts", async () => {
    const first = await render(<Toaster label="First" />);
    await render(<Toaster label="Second" />);
    expect(document.querySelectorAll('[data-ouro="toaster"]')).toHaveLength(1);
    expect(viewport()!.getAttribute("aria-label")).toBe("First");
    await show("Saved", { duration: 0 });
    expect(toasts()).toHaveLength(1);
    expect(warnings()).toContain(
      "[ouro-ui] Toaster: another <Toaster /> is already mounted, so this one shows toasts only after that one unmounts. Fix: render <Toaster /> once, at the root of your app.",
    );
    await first.unmount();
    await expect.poll(() => viewport()?.getAttribute("aria-label")).toBe("Second");
    await show("Saved again", { duration: 0 });
    expect(document.querySelectorAll('[data-ouro="toaster"]')).toHaveLength(1);
  });

  it("hands toasts to the next Toaster after the first unmounts", async () => {
    const first = await render(<Toaster />);
    await first.unmount();
    await render(<Toaster />);
    await show("Saved");
    expect(toasts()).toHaveLength(1);
  });

  it("works under StrictMode, which mounts effects twice", async () => {
    await render(
      <StrictMode>
        <Toaster />
      </StrictMode>,
    );
    await show("Saved");
    expect(toasts()).toHaveLength(1);
    expect(warnings()).toEqual([]);
  });
});

describe("toast()", () => {
  it("shows a toast named by its message, with its description, and returns its id", async () => {
    await render(<Toaster />);
    let id = "";
    await act(async () => {
      id = toast("Recipe saved", { description: "Find it in your cookbook." });
    });
    expect(id).toMatch(/^ouro-toast-\d+$/);
    await expect.element(page.getByRole("dialog", { name: "Recipe saved" })).toBeVisible();
    const item = toastNamed("Recipe saved")!;
    expect(item.getAttribute("aria-modal")).toBe("false");
    expect(item.querySelector("[data-ouro-toast-description]")!.textContent).toBe("Find it in your cookbook.");
    expect(document.getElementById(item.getAttribute("aria-describedby")!)!.textContent).toBe("Find it in your cookbook.");
  });

  it("marks the tone and shows an icon for every tone but secondary", async () => {
    await render(<Toaster />);
    const icons: Record<string, boolean> = {};
    for (const tone of ["secondary", "primary", "success", "warning", "destructive"] as const) {
      const item = await show(`A ${tone} toast`, { tone, duration: 0 });
      expect(item.getAttribute("data-tone")).toBe(tone);
      const icon = item.querySelector("[data-ouro-toast-icon]");
      icons[tone] = icon !== null;
      if (icon) expect(icon.getAttribute("aria-hidden")).toBe("true");
      // Three show at once; make room for the next.
      await act(async () => toast.dismiss());
      await gone(`A ${tone} toast`);
    }
    expect(icons).toEqual({ secondary: false, primary: true, success: true, warning: true, destructive: true });
  });

  it("defaults to secondary, and an unknown tone renders secondary and warns with the tone to use", async () => {
    await render(<Toaster />);
    expect((await show("Plain")).getAttribute("data-tone")).toBe("secondary");
    const options = { tone: "error" } as unknown as ToastOptions;
    expect((await show("Failed", options)).getAttribute("data-tone")).toBe("secondary");
    const odd = { tone: "loud" } as unknown as ToastOptions;
    await show("Odd", odd);
    expect(warnings()).toEqual([
      '[ouro-ui] toast: tone: "error" is not a tone; use "primary", "secondary", "destructive", "success", "warning". Fix: toast("…", { tone: "destructive" }).',
      '[ouro-ui] toast: tone: "loud" is not a tone; use "primary", "secondary", "destructive", "success", "warning". Fix: toast("…", { tone: "secondary" }).',
    ]);
  });

  it("warns for Sonner's options and shortcuts, with the Ouro UI call, and still shows the toast", async () => {
    await render(<Toaster />);
    const guessed = [
      { type: "success" },
      { variant: "error" },
      { variant: "odd" },
      { timeout: 8000 },
      { title: "Saved" },
    ] as unknown as ToastOptions[];
    for (const [index, options] of guessed.entries()) {
      await show(`Guess ${index}`, options);
      // Three show at once; make room for the next.
      await act(async () => toast.dismiss());
      await gone(`Guess ${index}`);
    }
    const shortcuts = toast as unknown as Record<"success" | "error" | "warning" | "info", (message: string, options?: ToastOptions) => string>;
    let saved = "";
    await act(async () => {
      saved = shortcuts.success("Saved");
      shortcuts.error("Failed");
      shortcuts.warning("Careful");
      shortcuts.info("Heads up", { description: "More" });
    });
    await expect.poll(() => toasts().length).toBeGreaterThanOrEqual(3);
    expect(warnings()).toEqual([
      '[ouro-ui] toast: type is not an option. Fix: toast("…", { tone: "success" }).',
      '[ouro-ui] toast: variant is not an option. Fix: toast("…", { tone: "destructive" }).',
      '[ouro-ui] toast: variant is not an option. Fix: toast("…", { tone: "secondary" }).',
      '[ouro-ui] toast: timeout is not an option. Fix: toast("…", { duration: 8000 }).',
      '[ouro-ui] toast: title is not an option; the message is the first argument. Fix: toast("Saved").',
      '[ouro-ui] toast: toast.success is not a function. Fix: toast("Saved", { tone: "success" }).',
      '[ouro-ui] toast: toast.error is not a function. Fix: toast("Failed", { tone: "destructive" }).',
      '[ouro-ui] toast: toast.warning is not a function. Fix: toast("Careful", { tone: "warning" }).',
      '[ouro-ui] toast: toast.info is not a function. Fix: toast("Heads up", { tone: "primary" }).',
    ]);
    // The fourth waits for a slot.
    await act(async () => toast.dismiss(saved));
    await expect.poll(() => toastNamed("Heads up")?.getAttribute("data-tone")).toBe("primary");
  });

  it("runs the action, then dismisses the toast", async () => {
    await render(<Toaster />);
    const onClick = vi.fn();
    const item = await show("Recipe deleted", { action: { label: "Undo", onClick }, duration: 0 });
    const undo = [...item.querySelectorAll("button")].find((button) => button.textContent === "Undo")!;
    expect(undo.getAttribute("type")).toBe("button");
    await userEvent.click(undo);
    expect(onClick).toHaveBeenCalledTimes(1);
    await gone("Recipe deleted");
  });

  it("closes from the dismiss button", async () => {
    await render(<Toaster />);
    const item = await show("Saved", { duration: 0 });
    await userEvent.click(item.querySelector<HTMLElement>('button[aria-label="Dismiss"]')!);
    await gone("Saved");
  });

  it("closes one toast with toast.dismiss(id), and all with toast.dismiss()", async () => {
    await render(<Toaster />);
    let first = "";
    await act(async () => {
      first = toast("First", { duration: 0 });
      toast("Second", { duration: 0 });
      toast("Third", { duration: 0 });
    });
    await expect.poll(() => toasts().length).toBe(3);
    await act(async () => toast.dismiss(first));
    await gone("First");
    expect(showing("Second") && showing("Third")).toBe(true);
    await act(async () => toast.dismiss());
    await expect.poll(() => toasts().length).toBe(0);
  });

  it("replaces a showing toast that has the same id", async () => {
    await render(<Toaster />);
    await show("Uploading", { id: "upload", duration: 0 });
    await act(async () => {
      toast("Uploaded", { id: "upload", tone: "success", duration: 0 });
    });
    await expect.poll(() => showing("Uploaded")).toBe(true);
    expect(toasts()).toHaveLength(1);
  });

  it("keeps a toast that has an action until it is dismissed, unless duration is given", async () => {
    await render(<Toaster />);
    await act(async () => {
      toast("Recipe deleted", { action: { label: "Undo", onClick: () => {} } });
      toast("Brief undo", { duration: 100, action: { label: "Undo", onClick: () => {} } });
      toast("Plain");
    });
    await gone("Brief undo");
    // A toast with no action goes after the default 5s; the one with an action stays.
    await expect.poll(() => toastNamed("Plain"), { timeout: 9000 }).toBeUndefined();
    await elapse(300);
    expect(showing("Recipe deleted")).toBe(true);
  });

  it("warns for a negative or NaN duration and uses the default", async () => {
    await render(<Toaster />);
    await act(async () => {
      toast("Negative", { duration: -1 });
      toast("Not a number", { duration: Number.NaN });
    });
    expect(warnings()).toEqual([
      '[ouro-ui] toast: duration: -1 is not a duration; use milliseconds, or 0 to keep the toast. Fix: toast("…", { duration: 5000 }).',
      '[ouro-ui] toast: duration: NaN is not a duration; use milliseconds, or 0 to keep the toast. Fix: toast("…", { duration: 5000 }).',
    ]);
    await expect.poll(() => showing("Negative")).toBe(true);
    await expect.poll(() => toastNamed("Negative"), { timeout: 8000 }).toBeUndefined();
    await expect.poll(() => toastNamed("Not a number"), { timeout: 2000 }).toBeUndefined();
  });

  it("dismisses itself after duration; 0 and Infinity keep it", async () => {
    await render(<Toaster />);
    // A 100ms toast can come and go between two polls on a loaded runner, so an observer
    // records it: its callback runs as a microtask after React inserts the toast, before
    // the dismiss timer can fire.
    let shown = false;
    const observer = new MutationObserver(() => {
      shown ||= showing("Brief");
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    try {
      await act(async () => {
        toast("Kept", { duration: 0 });
        toast("Kept forever", { duration: Infinity });
        toast("Brief", { duration: 100 });
      });
      await gone("Brief");
    } finally {
      observer.disconnect();
    }
    expect(shown).toBe(true);
    expect(showing("Kept") && showing("Kept forever")).toBe(true);
  });

  it("queues: up to three show, and later ones wait, out of the page, until a slot frees", async () => {
    await render(<Toaster />);
    const ids: string[] = [];
    await act(async () => {
      for (const n of [1, 2, 3, 4, 5]) ids.push(toast(`Toast ${n}`, { duration: 0 }));
    });
    await expect.poll(() => titles()).toEqual(["Toast 3", "Toast 2", "Toast 1"]);
    expect(toasts().some((item) => item.inert || item.hasAttribute("data-limited"))).toBe(false);
    await act(async () => toast.dismiss(ids[1]));
    await expect.poll(() => titles()).toEqual(["Toast 4", "Toast 3", "Toast 1"]);
    await act(async () => toast.dismiss(ids[0]));
    await expect.poll(() => titles()).toEqual(["Toast 5", "Toast 4", "Toast 3"]);
  });

  it("starts a waiting toast's countdown only when it shows, so it shows for its full duration and is announced once", async () => {
    await render(<Toaster />);
    const ids: string[] = [];
    await act(async () => {
      for (const n of [1, 2, 3]) ids.push(toast(`Kept ${n}`, { duration: 0 }));
    });
    const announced = watchAnnouncements();
    await act(async () => {
      toast("Timed", { duration: 1500 });
    });
    // Longer than its duration: it is still waiting, unseen and unspoken, not expired.
    await elapse(2000);
    expect(toastNamed("Timed")).toBeUndefined();
    expect(announced.count("Timed")).toBe(0);
    await act(async () => toast.dismiss(ids[0]));
    await expect.poll(() => showing("Timed")).toBe(true);
    const shownAt = performance.now();
    await gone("Timed");
    expect(performance.now() - shownAt).toBeGreaterThanOrEqual(1400);
    expect(announced.count("Timed")).toBe(1);
    announced.stop();
  });

  it("shows a timed toast for its full duration when three newer ones arrive, then shows the next", async () => {
    await render(<Toaster />);
    await show("Timed first", { duration: 1500 });
    const shownAt = performance.now();
    await act(async () => {
      for (const n of [2, 3, 4]) toast(`Toast ${n}`, { duration: 0 });
    });
    await expect.poll(() => titles()).toEqual(["Toast 3", "Toast 2", "Timed first"]);
    await gone("Timed first");
    expect(performance.now() - shownAt).toBeGreaterThanOrEqual(1400);
    await expect.poll(() => titles()).toEqual(["Toast 4", "Toast 3", "Toast 2"]);
  });

  it("dismisses a waiting toast by id, so it never shows", async () => {
    await render(<Toaster />);
    const ids: string[] = [];
    let waiting = "";
    await act(async () => {
      for (const n of [1, 2, 3]) ids.push(toast(`Kept ${n}`, { duration: 0 }));
      waiting = toast("Never shown", { duration: 0 });
      toast("Shown later", { duration: 0 });
    });
    await act(async () => toast.dismiss(waiting));
    await act(async () => toast.dismiss(ids[0]));
    await expect.poll(() => titles()).toEqual(["Shown later", "Kept 3", "Kept 2"]);
    await act(async () => toast.dismiss(ids[1]));
    await expect.poll(() => titles()).toEqual(["Shown later", "Kept 3"]);
    expect(toastNamed("Never shown")).toBeUndefined();
  });

  it("moves a destructive toast ahead of other waiting toasts, without pushing out a shown one", async () => {
    await render(<Toaster />);
    const ids: string[] = [];
    await act(async () => {
      for (const n of [1, 2, 3]) ids.push(toast(`Undo ${n}`, { action: { label: "Undo", onClick: () => {} } }));
      toast("Synced", { tone: "primary", duration: 0 });
      toast("Couldn't save", { tone: "destructive", duration: 0 });
      toast("Also failed", { tone: "destructive", duration: 0 });
    });
    await expect.poll(() => titles()).toEqual(["Undo 3", "Undo 2", "Undo 1"]);
    await act(async () => toast.dismiss(ids[0]));
    await expect.poll(() => titles()).toEqual(["Couldn't save", "Undo 3", "Undo 2"]);
    await act(async () => toast.dismiss(ids[1]));
    await expect.poll(() => titles()).toEqual(["Also failed", "Couldn't save", "Undo 3"]);
    await act(async () => toast.dismiss(ids[2]));
    await expect.poll(() => titles()).toEqual(["Synced", "Also failed", "Couldn't save"]);
  });

  /** Shows three kept toasts, runs `queue` while they show, then frees all three slots and returns what showed next. */
  async function waitingOrder(queue: () => void): Promise<Array<string | null>> {
    await render(<Toaster />);
    const ids: string[] = [];
    await act(async () => {
      for (const n of [1, 2, 3]) ids.push(toast(`Kept ${n}`, { duration: 0 }));
      queue();
    });
    await expect.poll(() => titles()).toEqual(["Kept 3", "Kept 2", "Kept 1"]);
    await act(async () => {
      for (const id of ids) toast.dismiss(id);
    });
    await expect.poll(() => titles().filter((title) => !title!.startsWith("Kept"))).toHaveLength(3);
    return titles().reverse();
  }

  it("moves a waiting toast replaced to a tone that is no longer destructive to the end of the destructive ones", async () => {
    const shown = await waitingOrder(() => {
      toast("D1", { id: "d1", tone: "destructive", duration: 0 });
      toast("D2", { tone: "destructive", duration: 0 });
      toast("N", { duration: 0 });
      toast("D1 resolved", { id: "d1", tone: "success", duration: 0 });
      toast("D3", { tone: "destructive", duration: 0 });
    });
    // Oldest first: D2 and D3 lead, then the replaced toast, then the others.
    expect(shown).toEqual(["D2", "D3", "D1 resolved"]);
  });

  it("moves a waiting toast replaced to a destructive tone ahead of the others", async () => {
    const shown = await waitingOrder(() => {
      toast("N0", { duration: 0 });
      toast("N1", { id: "n1", duration: 0 });
      toast("N2", { duration: 0 });
      toast("N1 failed", { id: "n1", tone: "destructive", duration: 0 });
    });
    expect(shown).toEqual(["N1 failed", "N0", "N2"]);
  });

  it("warns once when more than ten toasts are waiting, and keeps them all", async () => {
    await render(<Toaster />);
    const ids: string[] = [];
    await act(async () => {
      for (let n = 1; n <= 16; n++) ids.push(toast(`Toast ${n}`, { duration: 0 }));
    });
    expect(warnings()).toEqual([
      '[ouro-ui] Toaster: more than 10 toasts are waiting to show. Fix: send fewer toasts, or update one in place with toast("…", { id }).',
    ]);
    // No cap: the last one still shows once the others are dismissed.
    await act(async () => {
      for (const id of ids.slice(0, 13)) toast.dismiss(id);
    });
    await expect.poll(() => titles()).toEqual(["Toast 16", "Toast 15", "Toast 14"]);
  });

  it("replaces a waiting toast that has the same id, in its place in the queue", async () => {
    await render(<Toaster />);
    const ids: string[] = [];
    await act(async () => {
      for (const n of [1, 2, 3]) ids.push(toast(`Kept ${n}`, { duration: 0 }));
      toast("Uploading", { id: "upload", duration: 0 });
      toast("Next", { duration: 0 });
      toast("Uploaded", { id: "upload", duration: 0 });
    });
    await act(async () => toast.dismiss(ids[0]));
    await expect.poll(() => titles()).toEqual(["Uploaded", "Kept 3", "Kept 2"]);
  });

  it("puts the newest toast first in the page, where F6 then Tab reaches it, then each older one", async () => {
    await render(<Toaster />);
    await act(async () => {
      toast("First", { duration: 0 });
      toast("Second", { duration: 0 });
    });
    await act(async () => {
      toast("Third", { duration: 0 });
    });
    await expect.poll(() => toasts().length).toBe(3);
    expect(titles()).toEqual(["Third", "Second", "First"]);
    // The newest is in front.
    expect(Number(getComputedStyle(toastNamed("Third")!).zIndex)).toBeGreaterThan(Number(getComputedStyle(toastNamed("First")!).zIndex));
  });

  it("is announced once: politely through the Notifications region, and a destructive toast assertively (Review Focus 5)", async () => {
    await render(<Toaster />);
    const announced = watchAnnouncements();
    await act(async () => {
      toast("Recipe saved", { tone: "success", description: "In your cookbook." });
    });
    await act(async () => {
      toast("Photo added", { tone: "primary" });
    });
    await act(async () => {
      toast("Couldn't sync", { tone: "destructive", description: "Check your connection.", action: { label: "Retry", onClick: () => {} } });
    });
    await expect.poll(() => toasts().length).toBe(3);
    // Let height measurement and the enter transition run, which must not repeat the text.
    await elapse(400);
    announced.stop();
    expect(announced.count("Recipe saved")).toBe(1);
    expect(announced.count("Photo added")).toBe(1);
    expect(announced.matching("Recipe saved")[0]!.region).toBe(viewport());
    expect(announced.matching("Photo added")[0]!.region).toBe(viewport());
    // The destructive toast is spoken once, through an alert, and hidden from the polite region.
    expect(announced.count("Couldn't sync")).toBe(1);
    expect(announced.matching("Couldn't sync")[0]!.region.getAttribute("role")).toBe("alert");
    expect(toastNamed("Couldn't sync")!.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector("[data-ouro-announcer]")?.textContent ?? "").toBe("");
    // Polite toasts are spoken in the order they were added.
    const texts = announced.changes.map((change) => change.text);
    expect(texts.findIndex((text) => text.includes("Recipe saved"))).toBeLessThan(texts.findIndex((text) => text.includes("Photo added")));
  });

  it("waits for the Toaster when called before it mounts", async () => {
    let early = "";
    await act(async () => {
      early = toast("Early", { duration: 0 });
      const gone = toast("Early and gone", { duration: 0 });
      toast.dismiss(gone);
    });
    toast("Early and replaced", { id: "dup", duration: 0 });
    toast("Early, replacing", { id: "dup", duration: 0 });
    expect(early).toMatch(/^ouro-toast-/);
    await render(<Toaster />);
    await expect.poll(() => showing("Early")).toBe(true);
    expect(showing("Early, replacing")).toBe(true);
    expect(toastNamed("Early and replaced")).toBeUndefined();
    expect(toastNamed("Early and gone")).toBeUndefined();
    await act(async () => toast.dismiss("ouro-toast-unknown"));
    // The check for a missing Toaster runs later, and finds this one.
    await elapse(1200);
    expect(warnings()).toEqual([]);
  });

  it("drops waiting toasts with toast.dismiss() and keeps only the newest twenty", async () => {
    for (let n = 1; n <= 22; n++) toast(`Waiting ${n}`, { duration: 0 });
    await render(<Toaster />);
    // The oldest two were dropped; the next three show, and the other fifteen wait their turn.
    await expect.poll(() => titles()).toEqual(["Waiting 5", "Waiting 4", "Waiting 3"]);
    await act(async () => toast.dismiss());
    await expect.poll(() => toasts().length).toBe(0);
    roots.splice(0).forEach((root) => root.unmount());
    toast("Dropped", { duration: 0 });
    toast.dismiss();
    await render(<Toaster />);
    await act(async () => {});
    expect(toastNamed("Dropped")).toBeUndefined();
  });

  it("warns when no Toaster mounts", async () => {
    toast("Nobody sees this");
    toast("Nor this");
    await expect
      .poll(() => warnings())
      .toEqual(['[ouro-ui] toast: no <Toaster /> is mounted, so "Nobody sees this" is not shown. Fix: render <Toaster /> once, at the root of your app.']);
    toast.dismiss();
  });
});

describe("keyboard", () => {
  it("reaches and runs the oldest toast's action with F6, then Tab", async () => {
    await render(
      <>
        <button type="button">Before</button>
        <Toaster />
      </>,
    );
    const undo = vi.fn();
    for (const name of ["A", "B", "C"]) {
      await show(name, { action: { label: `Undo ${name}`, onClick: name === "A" ? undo : () => {} } });
    }
    await userEvent.click(page.getByRole("button", { name: "Before" }));
    await userEvent.keyboard("{F6}");
    await expect.poll(() => viewport()!.contains(document.activeElement)).toBe(true);
    const reached: string[] = [];
    for (let presses = 0; presses < 12 && document.activeElement?.textContent !== "Undo A"; presses++) {
      await pressTab();
      reached.push(document.activeElement?.textContent ?? "");
    }
    expect(document.activeElement?.textContent).toBe("Undo A");
    expect(reached.filter((text) => text.startsWith("Undo "))).toEqual(["Undo C", "Undo B", "Undo A"]);
    await userEvent.keyboard("{Enter}");
    expect(undo).toHaveBeenCalledTimes(1);
    await gone("A");
  });
});

describe("pausing", () => {
  it("pauses while the pointer is over the toasts, and resumes after", async () => {
    await render(
      <>
        <button type="button">Elsewhere</button>
        <Toaster />
      </>,
    );
    const item = await show("Paused", { duration: 3000 });
    await userEvent.hover(item);
    await expect.poll(() => viewport()!.hasAttribute("data-expanded")).toBe(true);
    await elapse(4000);
    expect(showing("Paused")).toBe(true);
    await userEvent.hover(page.getByRole("button", { name: "Elsewhere" }));
    await gone("Paused");
  });

  it("pauses while a toast has keyboard focus; F6 moves focus to the toasts", async () => {
    await render(
      <>
        <button type="button">Before</button>
        <Toaster />
      </>,
    );
    await userEvent.click(page.getByRole("button", { name: "Before" }));
    await show("Focused", { duration: 3000 });
    await userEvent.keyboard("{F6}");
    await expect.poll(() => viewport()!.contains(document.activeElement)).toBe(true);
    await elapse(4000);
    expect(showing("Focused")).toBe(true);
  });
});

describe("swiping", () => {
  async function swipe(item: HTMLElement, dx: number, dy: number) {
    const rect = item.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    await commands.drag({ from: [x, y], to: [x + dx, y + dy], steps: 12, durationMs: 200 });
  }

  /**
   * A pointer on the toast's message whose events carry the times the test gives them, so
   * a release velocity is exact on any machine and in every browser. `send(type, dx, at)`
   * dispatches one event `dx` px from where the pointer came down, `at` ms after it did.
   */
  function pointerOn(item: HTMLElement, target: Element = item.querySelector("[data-ouro-toast-title]")!) {
    const rect = item.getBoundingClientRect();
    const x = rect.left + 60;
    const y = rect.top + rect.height / 2;
    const start = performance.now();
    return (type: string, dx: number, at: number, init: PointerEventInit = {}) => {
      const event = new PointerEvent(type, { bubbles: true, isPrimary: true, button: 0, pointerId: 41, pointerType: "touch", clientX: x + dx, clientY: y, ...init });
      Object.defineProperty(event, "timeStamp", { value: start + at });
      target.dispatchEvent(event);
    };
  }
  const offsetOf = (item: HTMLElement) => parseFloat(getComputedStyle(item).translate.replace("none", "0"));
  const atRest = (item: HTMLElement) => expect.poll(() => !item.hasAttribute("data-ouro-settling") && item.style.translate === "").toBe(true);

  chromiumOnly("dismisses with a swipe down, right or left", async () => {
    await render(<Toaster />);
    for (const [message, dx, dy] of [
      ["Down", 0, 120],
      ["Right", 200, 0],
      ["Left", -200, 0],
    ] as const) {
      const item = await show(message, { duration: 0 });
      await swipe(item, dx, dy);
      await gone(message);
    }
  });

  chromiumOnly("springs back after a short swipe, and a swipe up does not dismiss", async () => {
    await render(<Toaster />);
    const item = await show("Stays", { duration: 0 });
    await swipe(item, 0, -120);
    await swipe(item, 0, 4);
    await elapse(300);
    expect(showing("Stays")).toBe(true);
  });

  chromiumOnly("follows the mouse 1:1 once it has moved 10px, and springs back when let go short of 40px", async () => {
    await render(<Toaster />);
    const item = await show("Follows", { duration: 0 });
    const rect = item.getBoundingClientRect();
    const x = rect.left + 60;
    const y = rect.top + rect.height / 2;
    try {
      await commands.drag({ from: [x, y], to: [x + 30, y], steps: 6, durationMs: 200, hold: true });
      expect(getComputedStyle(item).translate).toBe("30px");
      // A mouse at rest has no velocity: the distance decides.
      await elapse(150);
    } finally {
      await commands.pointerPress({ action: "up" });
    }
    await expect.poll(() => !item.hasAttribute("data-ouro-settling") && item.style.translate === "").toBe(true);
    expect(showing("Follows")).toBe(true);
  });

  chromiumOnly("dismisses on a quick flick of 30px, short of the 40px a slow release needs", async () => {
    await render(<Toaster />);
    const item = await show("Flicked", { duration: 0 });
    const rect = item.getBoundingClientRect();
    const x = rect.left + 60;
    const y = rect.top + rect.height / 2;
    await commands.flick({ from: [x, y], to: [x + 30, y], steps: 4, durationMs: 60 });
    await gone("Flicked");
  });

  it("comes back when the pointer turns round and flicks it home, though it is far out", async () => {
    await render(<Toaster />);
    const item = await show("Changed my mind", { duration: 0 });
    const send = pointerOn(item);
    send("pointerdown", 0, 0);
    send("pointermove", 12, 16);
    send("pointermove", 60, 32);
    send("pointermove", 120, 48);
    expect(getComputedStyle(item).translate).toBe("120px");
    // It rests, then goes back toward rest fast, and is let go while still 70px out.
    send("pointermove", 120, 400);
    send("pointermove", 100, 416);
    send("pointermove", 70, 432);
    send("pointerup", 70, 440);
    expect(item.hasAttribute("data-ouro-swiped")).toBe(false);
    await atRest(item);
    expect(showing("Changed my mind")).toBe(true);
  });

  it("comes back when it is let go far out but moving home slowly, and leaves when let go there at rest", async () => {
    await render(<Toaster />);
    const item = await show("Slowly home", { duration: 0 });
    let send = pointerOn(item);
    send("pointerdown", 0, 0);
    send("pointermove", 12, 16);
    send("pointermove", 120, 48);
    // Home at 0.05 px/ms, half the speed of a flick, and let go 70px out, still moving.
    for (let step = 1; step <= 10; step++) send("pointermove", 120 - step * 5, 400 + step * 100);
    send("pointerup", 67.5, 1450);
    expect(item.hasAttribute("data-ouro-swiped")).toBe(false);
    await atRest(item);
    expect(showing("Slowly home")).toBe(true);
    // The same place with the pointer at rest: far enough, and not on its way back.
    send = pointerOn(item);
    send("pointerdown", 0, 0);
    send("pointermove", 12, 16);
    send("pointermove", 70, 48);
    send("pointerup", 70, 400);
    expect(item.hasAttribute("data-ouro-swiped")).toBe(true);
    await gone("Slowly home");
  });

  it("starts its way back with the speed it was let go at", async () => {
    await render(<Toaster />);
    const item = await show("Carried", { duration: 0 });
    const frames = holdFrames();
    const send = pointerOn(item);
    send("pointerdown", 0, 0);
    send("pointermove", 12, 16);
    send("pointermove", 22, 116);
    send("pointermove", 30, 216);
    // Let go 30px out, still moving out at 0.08 px/ms: under a flick, and short of 40px, so it will come back.
    send("pointerup", 30, 216);
    expect(item.hasAttribute("data-ouro-settling")).toBe(true);
    frames.step(16);
    // Exactly where a spring handed that speed is after 16ms: further out than one started from rest, by most of the 1.3px the speed alone covers.
    expect(offsetOf(item)).toBeCloseTo(springAt(30, 0, 0.08, 16).value, 1);
    expect(offsetOf(item) - springAt(30, 0, 0, 16).value).toBeGreaterThan(0.5);
    frames.release();
    await atRest(item);
  });

  it("leaves with the speed it was thrown at", async () => {
    await render(<Toaster />);
    const item = await show("Thrown", { duration: 0 });
    // A long fade, so the toast is still on the page to be measured.
    item.style.transitionDuration = "20s";
    const frames = holdFrames();
    const send = pointerOn(item);
    send("pointerdown", 0, 0);
    send("pointermove", 15, 15);
    send("pointermove", 30, 30);
    // 1 px/ms at 30px out: a flick.
    await act(async () => send("pointerup", 30, 30));
    expect(item.hasAttribute("data-ouro-swiped")).toBe(true);
    const target = 30 + item.offsetWidth * 1.5;
    frames.step(16);
    expect(offsetOf(item)).toBeCloseTo(springAt(30, target, 1, 16).value, 1);
    // Further than the same exit started from rest, by most of the 16px the throw alone covers.
    expect(offsetOf(item) - springAt(30, target, 0, 16).value).toBeGreaterThan(10);
    frames.release();
    await expect.poll(() => item.hasAttribute("data-ending-style") && item.getAnimations().length > 0).toBe(true);
    for (const animation of item.getAnimations()) animation.finish();
    await gone("Thrown");
  });

  it("fades a swiped toast on the way it was thrown, and slides a closed one down", async () => {
    await render(<Toaster />);
    /** Where the toast's own `transform` ends up once its exit has run: how far down it slides. */
    const slidesTo = (item: HTMLElement) => {
      for (const animation of item.getAnimations()) animation.finish();
      return new DOMMatrix(getComputedStyle(item).transform).m42;
    };
    const swiped = await show("Swiped", { duration: 0 });
    swiped.style.transitionDuration = "20s";
    const send = pointerOn(swiped);
    send("pointerdown", 0, 0);
    send("pointermove", 15, 15);
    send("pointermove", 30, 30);
    await act(async () => send("pointerup", 30, 30));
    await expect.poll(() => swiped.hasAttribute("data-ending-style")).toBe(true);
    // The swipe carries it off sideways; the stack's transform takes it nowhere.
    expect(slidesTo(swiped)).toBe(0);
    await gone("Swiped");
    const closed = await show("Closed", { duration: 0 });
    closed.style.transitionDuration = "20s";
    await userEvent.click(closed.querySelector("button")!);
    await expect.poll(() => closed.hasAttribute("data-ending-style")).toBe(true);
    // One and a half times its height, down and off the screen.
    expect(slidesTo(closed)).toBeCloseTo(closed.offsetHeight * 1.5, 0);
    await gone("Closed");
  });

  it("shows a toast sent again with the id of one just swiped away, where a toast belongs, and it can be swiped again", async () => {
    await render(<Toaster />);
    const item = await show("Syncing", { id: "sync", duration: 0 });
    item.style.transitionDuration = "20s";
    let send = pointerOn(item);
    send("pointerdown", 0, 0);
    send("pointermove", 15, 15);
    send("pointermove", 30, 30);
    await act(async () => send("pointerup", 30, 30));
    expect(item.hasAttribute("data-ouro-swiped")).toBe(true);
    // The app sends the same toast again while it is still fading out: Base UI brings it back on the same element.
    await act(async () => {
      toast("Synced", { id: "sync", duration: 0 });
    });
    item.style.transitionDuration = "";
    await expect.poll(() => toastNamed("Synced")).toBe(item);
    expect(item.hasAttribute("data-ouro-swiped")).toBe(false);
    expect(item.hasAttribute("data-ouro-settling")).toBe(false);
    expect(item.style.translate).toBe("");
    await expect.poll(() => item.getAnimations().length).toBe(0);
    expect(showing("Synced")).toBe(true);
    const rect = item.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(innerWidth);
    // And it is the pointer's again.
    send = pointerOn(item);
    send("pointerdown", 0, 0);
    send("pointermove", 15, 15);
    expect(offsetOf(item)).toBe(15);
    await act(async () => send("pointerup", 30, 30));
    await gone("Synced");
  });

  it("keeps following the pointer when the toast is updated in the middle of a swipe, and when it is updated on its way back", async () => {
    await render(<Toaster />);
    const item = await show("Saving", { id: "save", duration: 0 });
    const frames = holdFrames();
    const send = pointerOn(item, item);
    send("pointerdown", 0, 0);
    send("pointermove", 12, 16);
    send("pointermove", 30, 32);
    await act(async () => {
      toast("Saved", { id: "save", duration: 0 });
    });
    expect(toastNamed("Saved")).toBe(item);
    expect(offsetOf(item)).toBe(30);
    send("pointermove", 36, 300);
    expect(offsetOf(item)).toBe(36);
    send("pointerup", 36, 600);
    // On its way back, another update: the spring carries on from where it is.
    frames.step(16);
    const flying = offsetOf(item);
    expect(flying).toBeLessThan(36);
    await act(async () => {
      toast("Saved again", { id: "save", duration: 0 });
    });
    expect(toastNamed("Saved again")).toBe(item);
    expect(item.hasAttribute("data-ouro-settling")).toBe(true);
    expect(offsetOf(item)).toBe(flying);
    frames.release();
    await atRest(item);
    expect(showing("Saved again")).toBe(true);
  });

  it("takes its press from the first pointer: a second one on a button does not stop the swipe, and one that began on a button starts none", async () => {
    await render(<Toaster />);
    const item = await show("Two fingers", { duration: 0 });
    const close = item.querySelector("button")!;
    // A finger on the message, then a second finger and a right click on the dismiss button, inside the first 10px.
    let send = pointerOn(item);
    send("pointerdown", 0, 0);
    send("pointermove", 6, 16);
    pointerOn(item, close)("pointerdown", 200, 20, { isPrimary: false, pointerId: 42 });
    pointerOn(item, close)("pointerdown", 200, 24, { button: 2, pointerId: 43, pointerType: "mouse" });
    send("pointermove", 20, 400);
    expect(offsetOf(item)).toBe(20);
    send("pointerup", 20, 800);
    await atRest(item);
    // A finger on the dismiss button, then a second one on the message: the button's press starts no swipe.
    send = pointerOn(item, close);
    send("pointerdown", 0, 0);
    pointerOn(item)("pointerdown", -100, 10, { isPrimary: false, pointerId: 42 });
    send("pointermove", -30, 400);
    expect(item.style.translate).toBe("");
    send("pointerup", -30, 800);
    expect(showing("Two fingers")).toBe(true);
  });

  it("starts no swipe from content marked data-swipe-ignore or data-base-ui-swipe-ignore, as before", async () => {
    await render(<Toaster />);
    for (const mark of ["data-swipe-ignore", "data-base-ui-swipe-ignore"]) {
      const item = await show(`Ignore ${mark}`, { duration: 0, description: <span {...{ [mark]: "" }}>Drag me and nothing moves</span> });
      const send = pointerOn(item, item.querySelector(`[${mark}]`)!);
      send("pointerdown", 0, 0);
      send("pointermove", 30, 400);
      expect(item.style.translate).toBe("");
      send("pointerup", 30, 800);
    }
  });

  chromiumOnly("does not start a swipe from the dismiss button", async () => {
    await render(<Toaster />);
    const item = await show("Button", { duration: 0 });
    const rect = item.querySelector("button")!.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    try {
      await commands.drag({ from: [x, y], to: [x - 80, y], steps: 6, durationMs: 200, hold: true });
      expect(item.style.translate).toBe("");
    } finally {
      await commands.pointerPress({ action: "up" });
    }
    expect(showing("Button")).toBe(true);
  });
});

describe("motion", () => {
  it("slides on the ease-out curve in 300ms or less, never animates height, and only fades with reduced motion", async () => {
    await render(<Toaster />);
    const item = await show("Moving", { duration: 0 });
    const style = getComputedStyle(item);
    expect(style.transitionProperty).toBe("transform, opacity");
    expect(style.transitionDuration).toBe("0.3s, 0.2s");
    expect(style.transitionTimingFunction).toBe("cubic-bezier(0.23, 1, 0.32, 1), cubic-bezier(0.23, 1, 0.32, 1)");
    const content = item.firstElementChild!;
    expect(getComputedStyle(content).transitionTimingFunction).toBe("cubic-bezier(0.23, 1, 0.32, 1)");
    await commands.emulateMedia({ reducedMotion: "reduce" });
    expect(getComputedStyle(item).transitionProperty).toBe("opacity");
    const fresh = await show("Still", { duration: 0 });
    expect(getComputedStyle(fresh).transitionProperty).toBe("opacity");
  });
});
