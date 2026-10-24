import { type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";
import { Celebrate } from "~/components/ouro/celebrate/celebrate";
import { act } from "~/lib/ouro/testing/act";
import { watchAnnouncements } from "~/lib/ouro/testing/announcements";
import { expectMotion, expectNoMotion, parseDuration } from "~/lib/ouro/testing/motion";

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
    root,
    get celebrate() {
      return host.querySelector<HTMLElement>('[data-ouro="celebrate"]')!;
    },
    get message() {
      return host.querySelector<HTMLElement>('[data-ouro-part="message"]');
    },
    get pieces() {
      return [...host.querySelectorAll<HTMLElement>('[data-ouro-part="piece"]')];
    },
  };
}

const token = (name: string) => parseDuration(getComputedStyle(document.documentElement).getPropertyValue(name));

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

describe("Celebrate", () => {
  it("shows nothing until the moment, then a badge with the message in the success tone", async () => {
    const { root, celebrate, message } = await render(<Celebrate show={false} message="List cleared" />);
    expect(message).toBeNull();
    expect(celebrate.hasAttribute("data-open")).toBe(false);
    await act(async () => root.render(<Celebrate show message="List cleared" />));
    const badge = celebrate.querySelector<HTMLElement>('[data-ouro-part="message"]')!;
    expect(badge.textContent).toBe("List cleared");
    expect(celebrate.hasAttribute("data-open")).toBe(true);
    const probe = document.createElement("span");
    probe.style.color = "color-mix(in oklab, var(--success) 80%, var(--foreground))";
    document.body.append(probe);
    mounted.push(probe);
    expect(getComputedStyle(badge).color).toBe(getComputedStyle(probe).color);
  });

  it("bursts its pieces outward and fades in its message, and with reduced motion only fades the message in", async () => {
    const { root, host } = await render(<Celebrate show={false} message="All done" />);
    for (const reduced of [false, true]) {
      await commands.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      flushSync(() => root.render(<Celebrate show message="All done" />));
      const piece = host.querySelector<HTMLElement>('[data-ouro-part="piece"]')!;
      const message = host.querySelector<HTMLElement>('[data-ouro-part="message"]')!;
      await Promise.all([
        reduced
          ? expectNoMotion(piece, { stem: "celebrate", state: "data-open", reduced })
          : expectMotion(piece, { stem: "celebrate", state: "data-open", properties: { transform: token("--ouro-duration-sheet"), opacity: token("--ouro-duration-slow") }, reduced }),
        expectMotion(message, { stem: "celebrate", state: "data-open", properties: { opacity: token("--ouro-duration-base") }, reduced }),
      ]);
      expect(getComputedStyle(message).opacity).toBe("1");
      if (reduced) expect(getComputedStyle(piece.parentElement!).display).toBe("none");
      else {
        expect(getComputedStyle(piece).opacity).toBe("0");
        expect(getComputedStyle(piece).transform).not.toBe("none");
      }
      await act(async () => root.render(<Celebrate show={false} message="All done" />));
    }
  });

  it("throws twelve pieces in every direction, in the theme's tones, hidden from screen readers", async () => {
    const { root, host } = await render(<Celebrate show={false} message="Done" />);
    await act(async () => root.render(<Celebrate show message="Done" />));
    const pieces = [...host.querySelectorAll<HTMLElement>('[data-ouro-part="piece"]')];
    expect(pieces).toHaveLength(12);
    expect(pieces[0]!.parentElement!.getAttribute("aria-hidden")).toBe("true");
    await expect.poll(() => pieces.every((piece) => piece.getAnimations().length === 0)).toBe(true);
    const centre = host.querySelector('[data-ouro-part="message"]')!.getBoundingClientRect();
    const [cx, cy] = [centre.left + centre.width / 2, centre.top + centre.height / 2];
    const quadrants = new Set(
      pieces.map((piece) => {
        const rect = piece.getBoundingClientRect();
        return `${rect.left + rect.width / 2 > cx ? "e" : "w"}${rect.top + rect.height / 2 > cy ? "s" : "n"}`;
      }),
    );
    expect(quadrants).toEqual(new Set(["en", "es", "wn", "ws"]));
    const colours = new Set(pieces.map((piece) => getComputedStyle(piece).backgroundColor));
    expect(colours.size).toBe(4);
  });

  it("says the message once after a delay when the moment starts, and again for the next one", async () => {
    // celebrate.tsx's SPEAK_DELAY_MS.
    const SPEAK_DELAY_MS = 1500;
    const announced = watchAnnouncements();
    try {
      const { root } = await render(<Celebrate show={false} message="List cleared" />);
      await act(async () => root.render(<Celebrate show message="List cleared" />));
      // The message must not compete immediately with the triggering control's announcement.
      await new Promise((resolve) => setTimeout(resolve, SPEAK_DELAY_MS - 300));
      expect(announced.count("List cleared")).toBe(0);
      await expect.poll(() => announced.count("List cleared"), { timeout: 2000 }).toBe(1);
      await act(async () => root.render(<Celebrate show message="List cleared" className="mt-2" />));
      await act(async () => root.render(<Celebrate show={false} message="List cleared" />));
      await act(async () => root.render(<Celebrate show message="List cleared" />));
      await expect.poll(() => announced.count("List cleared"), { timeout: SPEAK_DELAY_MS + 1000 }).toBe(2);
    } finally {
      announced.stop();
    }
  });

  it("says nothing when the page opens with it already shown", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const announced = watchAnnouncements();
    try {
      await render(<Celebrate show message="Already done" />);
      await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
      expect(announced.count("Already done")).toBe(0);
    } finally {
      announced.stop();
      vi.useRealTimers();
    }
  });

  it("keeps the message for screen readers only with hideMessage", async () => {
    const { root, host } = await render(<Celebrate show={false} message="Saved" hideMessage />);
    await act(async () => root.render(<Celebrate show message="Saved" hideMessage />));
    const message = host.querySelector<HTMLElement>('[data-ouro-part="message"]')!;
    expect(message.getBoundingClientRect().width).toBeLessThanOrEqual(1);
    expect(message.textContent).toBe("Saved");
  });

  it("forwards a ref, passes attributes through, and lets layout classes win", async () => {
    let element: HTMLSpanElement | null = null;
    const { celebrate } = await render(<Celebrate show message="x" className="ms-4" id="party" ref={(node) => void (element = node)} />);
    expect(element).toBe(celebrate);
    expect(celebrate.id).toBe("party");
    expect(getComputedStyle(celebrate).marginInlineStart).toBe("16px");
  });
});

describe("Celebrate development messages", () => {
  it.each([
    ["open", { open: true }, "open is not a prop", "<Celebrate show={done} />"],
    ["active", { active: true }, "active is not a prop", "<Celebrate show={done} />"],
    ["children", { children: "Hooray" }, "Celebrate takes its text as message", '<Celebrate message="Hooray" />'],
    ["children", { children: <b>Hi</b> }, "Celebrate takes its text as message", '<Celebrate message="All done" />'],
  ])("explains %s with the fix", async (_name, extra, problem, fix) => {
    const props = { show: false, message: "x", ...extra } as unknown as Parameters<typeof Celebrate>[0];
    const { celebrate } = await render(<Celebrate {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Celebrate: ${problem}. Fix: ${fix}.`);
    expect(celebrate.hasAttribute("open")).toBe(false);
    expect(celebrate.hasAttribute("active")).toBe(false);
  });

  it.each([
    ["text-green-600", 'remove "text-green-600"; Celebrate takes its colors from the theme'],
    ["mx-auto", ""],
  ])("checks the className %s", async (className, fix) => {
    await render(<Celebrate show={false} message="x" className={className} />);
    if (fix) expect(warn).toHaveBeenCalledWith(`[ouro-ui] Celebrate: "${className}" sets appearance, and className is for layout only. Fix: ${fix}.`);
    else expect(warn).not.toHaveBeenCalled();
  });

  it("renders to a string", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(<Celebrate show message="Done" />);
    expect(html).toContain('data-ouro="celebrate"');
    expect(html).toContain("Done");
    expect(error).not.toHaveBeenCalled();
  });
});
