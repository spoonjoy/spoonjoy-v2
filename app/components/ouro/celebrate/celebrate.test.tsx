import { StrictMode, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";
import { Celebrate } from "~/components/ouro/celebrate/celebrate";
import { Moment } from "~/components/ouro/moment/moment";
import { OuroProvider } from "~/lib/ouro/ouro-provider";
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

  it("carries data-celebrate while the moment lasts, and not before or after", async () => {
    const { root, celebrate } = await render(<Celebrate show={false} message="List cleared" />);
    expect(celebrate.hasAttribute("data-celebrate")).toBe(false);
    await act(async () => root.render(<Celebrate show message="List cleared" />));
    expect(celebrate.getAttribute("data-celebrate")).toBe("");
    await act(async () => root.render(<Celebrate show={false} message="List cleared" />));
    expect(celebrate.hasAttribute("data-celebrate")).toBe(false);
  });

  it("shows and speaks only the message under OuroProvider's quiet, with no confetti", async () => {
    const announced = watchAnnouncements();
    try {
      const { root, host } = await render(
        <OuroProvider quiet>
          <Celebrate show={false} message="Inbox cleared" />
        </OuroProvider>,
      );
      await act(async () =>
        root.render(
          <OuroProvider quiet>
            <Celebrate show message="Inbox cleared" />
          </OuroProvider>,
        ),
      );
      const celebrate = host.querySelector<HTMLElement>('[data-ouro="celebrate"]')!;
      expect(celebrate.getAttribute("data-quiet")).toBe("");
      expect(host.querySelectorAll('[data-ouro-part="piece"]')).toHaveLength(0);
      expect(host.querySelector('[data-ouro-part="message"]')!.textContent).toBe("Inbox cleared");
      await expect.poll(() => announced.count("Inbox cleared")).toBe(1);
      await act(async () => root.render(<Celebrate show message="Inbox cleared" />));
      expect(host.querySelector('[data-ouro="celebrate"]')!.hasAttribute("data-quiet")).toBe(false);
      expect(host.querySelectorAll('[data-ouro-part="piece"]')).toHaveLength(12);
    } finally {
      announced.stop();
    }
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
        // The layer ends at full size, so the piece has come out of the middle.
        const dot = piece.firstElementChild!.getBoundingClientRect();
        const box = host.querySelector('[data-ouro="celebrate"]')!.getBoundingClientRect();
        expect(Math.abs(dot.left + dot.width / 2 - (box.left + box.width / 2))).toBeGreaterThan(4);
      }
      await act(async () => root.render(<Celebrate show={false} message="All done" />));
    }
  });

  it("throws twelve pieces in every direction, at two distances, in the theme's tones, inside its own box and hidden from screen readers", async () => {
    const { root, host } = await render(<Celebrate show={false} message="Done" className="h-24 w-64" />);
    await act(async () => root.render(<Celebrate show message="Done" className="h-24 w-64" />));
    const pieces = [...host.querySelectorAll<HTMLElement>('[data-ouro-part="piece"]')];
    expect(pieces).toHaveLength(12);
    expect(pieces[0]!.parentElement!.getAttribute("aria-hidden")).toBe("true");
    await expect.poll(() => pieces.every((piece) => piece.getAnimations().length === 0)).toBe(true);
    const box = host.querySelector('[data-ouro="celebrate"]')!.getBoundingClientRect();
    const [cx, cy] = [box.left + box.width / 2, box.top + box.height / 2];
    const dots = pieces.map((piece) => piece.firstElementChild!.getBoundingClientRect());
    const quadrants = new Set(dots.map((rect) => `${rect.left + rect.width / 2 > cx ? "e" : "w"}${rect.top + rect.height / 2 > cy ? "s" : "n"}`));
    expect(quadrants).toEqual(new Set(["en", "es", "wn", "ws"]));
    for (const rect of dots) {
      expect(rect.left).toBeGreaterThanOrEqual(box.left - 0.5);
      expect(rect.right).toBeLessThanOrEqual(box.right + 0.5);
      expect(rect.top).toBeGreaterThanOrEqual(box.top - 0.5);
      expect(rect.bottom).toBeLessThanOrEqual(box.bottom + 0.5);
    }
    // Every other piece lands nearer the middle: as a share of the box's width and height, 0.44 out and 0.3 out.
    const reach = dots.map((rect) => Math.hypot((rect.left + rect.width / 2 - cx) / box.width, (rect.top + rect.height / 2 - cy) / box.height));
    reach.forEach((share, index) => expect(Math.abs(share - (index % 2 ? 0.3 : 0.44))).toBeLessThan(0.02));
    const colours = new Set(pieces.map((piece) => getComputedStyle(piece.firstElementChild!).backgroundColor));
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
      // short poll: the message comes once its delay has passed, not seconds later.
      await expect.poll(() => announced.count("List cleared"), { timeout: 2000 }).toBe(1);
      await act(async () => root.render(<Celebrate show message="List cleared" className="mt-2" />));
      await act(async () => root.render(<Celebrate show={false} message="List cleared" />));
      await act(async () => root.render(<Celebrate show message="List cleared" />));
      // short poll: the next message comes after the same delay, not seconds later.
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

describe("Celebrate cap", () => {
  const frames = () => act(async () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const clear = () => Object.keys(localStorage).filter((key) => key.startsWith("ouro-moment:")).forEach((key) => localStorage.removeItem(key));
  beforeEach(clear);
  afterEach(clear);

  /** Shows a Celebrate that was hidden, and says whether its confetti burst. */
  async function bursts(props: Partial<Parameters<typeof Celebrate>[0]>) {
    const { root, host } = await render(<Celebrate show={false} message="Inbox cleared" {...props} />);
    await act(async () => root.render(<Celebrate show message="Inbox cleared" {...props} />));
    await frames();
    const result = host.querySelectorAll('[data-ouro-part="piece"]').length === 12;
    expect(host.querySelector('[data-ouro-part="message"]')!.textContent).toBe("Inbox cleared");
    return { result, root, host };
  }

  it("bursts at most times per period under its key, then shows and speaks the message alone", async () => {
    let now = Date.UTC(2026, 10, 1, 12);
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const announced = watchAnnouncements();
    const node = (show: boolean) => <Celebrate show={show} message="Inbox cleared" cap={{ times: 1, per: "day" }} capKey="cleared" />;
    const pieces = (host: Element) => host.querySelectorAll('[data-ouro-part="piece"]').length;
    try {
      const { root, host, result } = await bursts({ cap: { times: 1, per: "day" }, capKey: "cleared" });
      expect(result).toBe(true);
      await expect.poll(() => announced.count("Inbox cleared")).toBe(1);
      await act(async () => root.render(node(false)));
      await frames();
      // Shown again within the day: no confetti, not even for a frame, and the message is heard.
      flushSync(() => root.render(node(true)));
      expect(pieces(host)).toBe(0);
      await frames();
      expect(pieces(host)).toBe(0);
      expect(host.querySelector('[data-ouro-part="message"]')!.textContent).toBe("Inbox cleared");
      await expect.poll(() => announced.count("Inbox cleared")).toBe(2);
      await act(async () => root.render(node(false)));
      await frames();
      now += 24 * 60 * 60 * 1000;
      await act(async () => root.render(node(true)));
      await frames();
      expect(pieces(host)).toBe(12);
      expect(JSON.parse(localStorage.getItem("ouro-moment:shown:cleared")!)).toEqual([now]);
      expect((await bursts({ cap: { times: 1, per: "day" }, id: "cleared" })).result).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      announced.stop();
    }
  });

  it("decides once as a showing starts, even when the page opens with it shown, and never bursts for a frame it may not", async () => {
    const twice = { cap: { times: 2, per: "day" }, capKey: "opened" } as const;
    const { host } = await render(
      <StrictMode>
        <Celebrate show message="Inbox cleared" {...twice} />
      </StrictMode>,
    );
    await frames();
    expect(host.querySelectorAll('[data-ouro-part="piece"]')).toHaveLength(12);
    expect(JSON.parse(localStorage.getItem("ouro-moment:shown:opened")!)).toHaveLength(1);
    localStorage.setItem("ouro-moment:shown:spent", JSON.stringify([Date.now()]));
    const later = await render(null);
    flushSync(() => later.root.render(<Celebrate show message="Inbox cleared" cap={{ times: 1, per: "day" }} capKey="spent" />));
    expect(later.host.querySelectorAll('[data-ouro-part="piece"]')).toHaveLength(0);
    await frames();
    expect(later.host.querySelectorAll('[data-ouro-part="piece"]')).toHaveLength(0);
  });

  it("holds to every cap it is given, and counts a burst against each", async () => {
    const shared = { times: 2, per: "week", key: "celebrations" } as const;
    expect((await bursts({ cap: [{ times: 1, per: "ever", key: "a" }, shared] })).result).toBe(true);
    expect((await bursts({ cap: [{ times: 1, per: "ever", key: "a" }, shared] })).result).toBe(false);
    expect((await bursts({ cap: [{ times: 1, per: "month", key: "b" }, shared] })).result).toBe(true);
    expect((await bursts({ cap: [{ times: 1, per: "ever", key: "c" }, shared] })).result).toBe(false);
    expect(localStorage.getItem("ouro-moment:shown:c")).toBeNull();
    expect(JSON.parse(localStorage.getItem("ouro-moment:shown:celebrations")!)).toHaveLength(2);
  });

  it("shares a key with Moment's cap", async () => {
    const { host } = await render(<Moment kind="success" art={<svg viewBox="0 0 10 10" />} title="All caught up" dismissKey="caught-up" cap={{ times: 1, per: "day" }} />);
    await expect.poll(() => host.querySelector("[data-celebrate]")).not.toBeNull();
    expect((await bursts({ cap: { times: 1, per: "day" }, capKey: "caught-up" })).result).toBe(false);
  });

  it("bursts without a key to count under, or with an unknown period counted as a day, and says so", async () => {
    expect((await bursts({ cap: { times: 0, per: "day" } })).result).toBe(true);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] Celebrate: a cap counts bursts under its key, capKey or id, and this one has none. Fix: <Celebrate cap={{ times: 3, per: "day" }} capKey="cleared">.');
    const hourly = { cap: { times: 1, per: "hour" as "day" }, capKey: "hourly" };
    expect((await bursts(hourly)).result).toBe(true);
    expect((await bursts(hourly)).result).toBe(false);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] Celebrate: cap per "hour" is not a period; use "day", "week", "month", "ever". Fix: <Celebrate cap={{ times: 3, per: "day" }} capKey="cleared">.');
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
