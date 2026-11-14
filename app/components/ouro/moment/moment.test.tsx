import { StrictMode, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Button } from "~/components/ouro/button/button";
import { Moment, MomentProvider } from "~/components/ouro/moment/moment";
import { OuroProvider } from "~/lib/ouro/ouro-provider";
import { act } from "~/lib/ouro/testing/act";
import { watchAnnouncements } from "~/lib/ouro/testing/announcements";
import { expectMotion, expectNoMotion, parseDuration } from "~/lib/ouro/testing/motion";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode, width = 480) {
  const host = document.createElement("div");
  host.style.width = `${width}px`;
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    root,
    get moment() {
      return host.querySelector<HTMLElement>('[data-ouro="moment"]');
    },
    get frame() {
      return host.querySelector<HTMLElement>("[data-ouro-moment-frame]");
    },
    get art() {
      return host.querySelector<HTMLElement>("[data-ouro-moment-art]");
    },
  };
}

const frames = (count = 2) =>
  act(async () => {
    for (let index = 0; index < count; index++) await new Promise((resolve) => requestAnimationFrame(resolve));
  });

/** Resolves once `element` carries `attribute`, in the microtask after the change, so a motion check can start right away. */
function attributeAdded(element: HTMLElement, attribute: string): Promise<void> {
  if (element.hasAttribute(attribute)) return Promise.resolve();
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (!element.hasAttribute(attribute)) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(element, { attributes: true, attributeFilter: [attribute] });
  });
}

const token = (name: string) => parseDuration(getComputedStyle(document.documentElement).getPropertyValue(name));

function colourOf(value: string): string {
  const probe = document.createElement("span");
  probe.style.color = value;
  document.body.append(probe);
  mounted.push(probe);
  return getComputedStyle(probe).color;
}

const Art = ({ id = "art" }: { id?: string }) => (
  <svg viewBox="0 0 160 120" data-testid={id}>
    <circle cx="80" cy="60" r="40" fill="currentColor" />
  </svg>
);

function clearStored() {
  for (const key of Object.keys(localStorage)) if (key.startsWith("ouro-moment:")) localStorage.removeItem(key);
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  clearStored();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
  clearStored();
  await commands.emulateMedia({ reducedMotion: "no-preference" });
});

describe("Moment", () => {
  it("renders the art, an <h3> title, the line and up to two actions", async () => {
    const { moment, art } = await render(
      <Moment
        art={<Art />}
        title="No messages yet"
        description="Messages you send show up here."
        action={<Button>New message</Button>}
        secondaryAction={<Button variant="plain">Learn more</Button>}
      />,
    );
    expect(moment!.getAttribute("data-ouro")).toBe("moment");
    await expect.element(page.getByRole("heading", { level: 3, name: "No messages yet" })).toBeVisible();
    await expect.element(page.getByText("Messages you send show up here.")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "New message" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Learn more" })).toBeVisible();
    expect(art!.querySelector("[data-testid=art]")).not.toBeNull();
    expect(getComputedStyle(moment!).alignItems).toBe("center");
    expect(getComputedStyle(moment!).textAlign).toBe("center");
    expect(moment!.hasAttribute("data-quiet")).toBe(false);
    const heading = moment!.querySelector("h3")!;
    const line = page.getByText("Messages you send show up here.").element() as HTMLElement;
    expect(getComputedStyle(heading).whiteSpace).not.toBe("nowrap");
    expect(getComputedStyle(line).whiteSpace).not.toBe("nowrap");
    expect(getComputedStyle(heading.parentElement!).flexDirection).toBe("column");
    expect(getComputedStyle(heading.parentElement!).alignItems).toBe("center");
    const actions = moment!.querySelector<HTMLElement>("[data-ouro-moment-actions]")!;
    expect(getComputedStyle(actions).flexWrap).toBe("wrap");
    expect(getComputedStyle(actions).justifyContent).toBe("center");
    expect(warn).not.toHaveBeenCalled();
  });

  it("names its kind in data-moment and colours the art from the theme by kind", async () => {
    const expected = {
      empty: "var(--muted-foreground)",
      loading: "var(--muted-foreground)",
      error: "var(--destructive)",
      "first-run": "var(--primary)",
      success: "var(--success)",
      ask: "var(--primary)",
    } as const;
    for (const [kind, colour] of Object.entries(expected)) {
      const { moment, frame } = await render(<Moment kind={kind as keyof typeof expected} art={<Art />} title={kind} celebrate={false} />);
      expect(moment!.getAttribute("data-moment")).toBe(kind);
      expect(getComputedStyle(frame!).color).toBe(colourOf(colour));
    }
  });

  it("marks its art with data-moment-art, carrying artName", async () => {
    const plain = await render(<Moment art={<Art />} title="Nothing here" />);
    expect(plain.art!.getAttribute("data-moment-art")).toBe("");
    const named = await render(<Moment art={<Art />} artName="waving" title="Welcome" />);
    expect(named.art!.getAttribute("data-moment-art")).toBe("waving");
    expect(named.host.querySelectorAll("[data-moment-art]")).toHaveLength(1);
    const bare = await render(<Moment kind="loading" title="Loading" />);
    expect(bare.host.querySelector("[data-moment-art]")).toBeNull();
  });

  it("takes welcome as first-run's older name, and says first-run", async () => {
    const { moment, frame } = await render(<Moment kind="welcome" art={<Art />} title="Welcome in" />);
    expect(moment!.getAttribute("data-moment")).toBe("first-run");
    expect(getComputedStyle(frame!).color).toBe(colourOf("var(--primary)"));
    expect(warn).not.toHaveBeenCalled();
  });

  it("hides the art from screen readers, or names it with artLabel", async () => {
    const hidden = await render(<Moment art={<Art />} title="Nothing here" />);
    expect(hidden.art!.getAttribute("aria-hidden")).toBe("true");
    expect(hidden.art!.hasAttribute("role")).toBe(false);
    await render(<Moment art={<Art id="named" />} artLabel="An empty tray under a small moon" title="Nothing here" />);
    await expect.element(page.getByRole("img", { name: "An empty tray under a small moon" })).toBeVisible();
  });

  it("shows a spinner for a loading moment without art, sized to the layout", async () => {
    for (const [props, px] of [
      [{}, 32],
      [{ quiet: true }, 20],
      [{ size: "inline" as const }, 16],
    ] as const) {
      const { host, art } = await render(<Moment kind="loading" title="Loading messages" {...props} />);
      const spinner = host.querySelector<HTMLElement>('[data-ouro="spinner"]')!;
      expect(spinner.getBoundingClientRect().height).toBe(px);
      expect(art!.getAttribute("aria-hidden")).toBe("true");
      expect(art!.contains(spinner)).toBe(true);
    }
    const withArt = await render(<Moment kind="loading" art={<Art />} title="Loading" />);
    expect(withArt.host.querySelector('[data-ouro="spinner"]')).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("leaves out the art, line and actions when they are empty", async () => {
    for (const empty of [undefined, null, false]) {
      const { moment, frame } = await render(<Moment art={empty} description={empty} action={empty} secondaryAction={empty} title="Bare" />);
      expect(frame).toBeNull();
      expect(moment!.querySelector("[data-ouro-moment-actions]")).toBeNull();
      expect(moment!.textContent).toBe("Bare");
    }
    const one = await render(<Moment title="One" secondaryAction={<Button>Only</Button>} />);
    expect(one.moment!.querySelector("[data-ouro-moment-actions]")!.textContent).toBe("Only");
  });

  it("stays in the page's flow, and its celebration stays inside the art's frame", async () => {
    const { host, moment, frame } = await render(
      <div>
        <p style={{ margin: 0 }}>Before</p>
        <Moment kind="success" art={<Art />} title="All caught up" />
        <p style={{ margin: 0 }}>After</p>
      </div>,
    );
    await expect.poll(() => moment!.hasAttribute("data-celebrate")).toBe(true);
    expect(moment!.getAttribute("data-celebrate")).toBe("");
    expect(moment!.getAttribute("data-open")).toBe("");
    expect(["static", "relative"]).toContain(getComputedStyle(moment!).position);
    const [before, after] = [...host.querySelectorAll("p")].map((node) => node.getBoundingClientRect());
    const box = moment!.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(before!.bottom - 0.5);
    expect(after!.top).toBeGreaterThanOrEqual(box.bottom - 0.5);
    const parts = [...host.querySelectorAll<HTMLElement | SVGElement>("[data-ouro-part=halo], [data-ouro-part=sparkle]")];
    expect(parts).toHaveLength(5);
    await expect.poll(() => parts.every((part) => part.getAnimations().length === 0)).toBe(true);
    const edge = frame!.getBoundingClientRect();
    for (const part of parts) {
      const rect = part.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(edge.left - 0.5);
      expect(rect.right).toBeLessThanOrEqual(edge.right + 0.5);
      expect(rect.top).toBeGreaterThanOrEqual(edge.top - 0.5);
      expect(rect.bottom).toBeLessThanOrEqual(edge.bottom + 0.5);
      expect(part.getAttribute("aria-hidden")).toBe("true");
      expect(getComputedStyle(part).pointerEvents).toBe("none");
    }
    const halo = host.querySelector<HTMLElement>("[data-ouro-part=halo]")!.getBoundingClientRect();
    expect(Math.abs(halo.width - halo.height)).toBeLessThan(1);
  });

  it("speaks a success or error moment politely only when asked", async () => {
    const announced = watchAnnouncements();
    // The shared live region speaks the last message given within about 100ms, so each quiet
    // moment gets time to be heard before the next render.
    const heardIfSpoken = () => new Promise((resolve) => setTimeout(resolve, 400));
    try {
      await render(<Moment kind="error" announce title="Not sent: you're offline" description="Check your connection." />);
      await expect.poll(() => announced.count("Not sent: you're offline. Check your connection.")).toBe(1);
      await render(<Moment kind="success" title="Saved quietly" />);
      await heardIfSpoken();
      await render(<Moment kind="empty" announce title="Nothing to say" />);
      await heardIfSpoken();
      await render(<Moment kind="success" announce title="Sent" description={<strong>to Ana</strong>} />);
      await expect.poll(() => announced.count("Sent")).toBe(1);
      // A moment that turns into a success is heard then, and again when what it says changes.
      const turning = await render(<Moment kind="loading" title="Uploading" />);
      await act(async () => turning.root.render(<Moment kind="success" announce title="Uploaded" />));
      await expect.poll(() => announced.count("Uploaded")).toBe(1);
      await act(async () => turning.root.render(<Moment kind="success" announce title="Uploaded twice" />));
      await expect.poll(() => announced.count("Uploaded twice")).toBe(1);
      expect(announced.count("Saved quietly")).toBe(0);
      expect(announced.count("Nothing to say")).toBe(0);
      expect(announced.count("[object")).toBe(0);
      expect(announced.count("Not sent: you're offline")).toBe(1);
    } finally {
      announced.stop();
    }
  });

  it("passes attributes and a ref through, and lets layout classes win", async () => {
    let node: HTMLDivElement | null = null;
    const { moment } = await render(<Moment title="Nothing" id="moment" className="mt-6" ref={(element) => void (node = element)} />);
    expect(moment!.id).toBe("moment");
    expect(node).toBe(moment);
    expect(getComputedStyle(moment!).marginTop).toBe("24px");
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([2, 4, 5, 6] as const)("renders the title at headingLevel %i", async (level) => {
    await render(<Moment title="Nothing here" headingLevel={level} />);
    await expect.element(page.getByRole("heading", { level, name: "Nothing here" })).toBeVisible();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("Moment sizes", () => {
  it("gives the art 160px, 96px in a pane narrower than 24rem, and 24px inline", async () => {
    const cases = [
      [{}, 480, 160],
      [{}, 392, 160],
      [{}, 376, 96],
      [{}, 320, 96],
      [{ size: "inline" as const }, 480, 24],
    ] as const;
    for (const [props, width, px] of cases) {
      const { frame, art } = await render(<Moment art={<Art />} title="Nothing here" {...props} />, width);
      expect(frame!.getBoundingClientRect().height).toBe(px);
      expect(art!.querySelector("svg")!.getBoundingClientRect().height).toBe(px);
    }
  });

  it("gives hero art 220px, and 96px in a pane narrower than 24rem", async () => {
    for (const [width, px] of [
      [640, 220],
      [376, 96],
    ] as const) {
      const { moment, frame, art } = await render(<Moment size="hero" art={<Art />} title="Pick a conversation" />, width);
      expect(frame!.getBoundingClientRect().height).toBe(px);
      expect(art!.querySelector("svg")!.getBoundingClientRect().height).toBe(px);
      expect(getComputedStyle(moment!).flexDirection).toBe("column");
    }
    // Quiet wins over hero: a quiet hero moment is words only, with no art.
    const { frame } = await render(<Moment size="hero" quiet art={<Art />} title="Pick a conversation" />, 640);
    expect(frame).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("is one row inline, with a plain-text title unless given a heading level", async () => {
    const { moment } = await render(<Moment size="inline" kind="loading" title="Syncing" description="12 of 40 messages" />);
    expect(getComputedStyle(moment!).flexDirection).toBe("row");
    expect(page.getByRole("heading").elements()).toHaveLength(0);
    await expect.element(page.getByText("12 of 40 messages")).toBeVisible();
    const inlineLine = page.getByText("12 of 40 messages").element() as HTMLElement;
    expect(inlineLine.tagName).toBe("SPAN");
    expect(getComputedStyle(inlineLine.parentElement!).flexDirection).toBe("row");
    expect(getComputedStyle(inlineLine.parentElement!).alignItems).toBe("baseline");
    expect(warn).not.toHaveBeenCalled();
    await render(<Moment size="inline" title="Synced" headingLevel={4} />);
    await expect.element(page.getByRole("heading", { level: 4, name: "Synced" })).toBeVisible();
  });
});

describe("Moment quiet", () => {
  it("renders a compact row from the prop or from MomentProvider, and the prop wins", async () => {
    const own = await render(<Moment quiet art={<Art />} title="No drafts" description="Drafts you start show up here, one line at most." action={<Button size="sm">New draft</Button>} />);
    const actions = own.moment!.querySelector<HTMLElement>("[data-ouro-moment-actions]")!;
    expect(own.frame).toBeNull();
    expect(actions.getBoundingClientRect().top).toBeLessThan(own.moment!.querySelector("h3")!.getBoundingClientRect().bottom);
    expect(own.moment!.getAttribute("data-quiet")).toBe("");
    expect(getComputedStyle(own.moment!).flexDirection).toBe("row");
    const line = page.getByText("Drafts you start show up here, one line at most.").element() as HTMLElement;
    expect(getComputedStyle(line).whiteSpace).toBe("nowrap");
    expect(line.tagName).toBe("DIV");
    const title = own.moment!.querySelector("h3")!;
    expect(getComputedStyle(title).whiteSpace).toBe("nowrap");
    expect(getComputedStyle(title.parentElement!).flexDirection).toBe("column");
    expect(getComputedStyle(title.parentElement!).flexGrow).toBe("1");
    const ownActions = own.moment!.querySelector<HTMLElement>("[data-ouro-moment-actions]")!;
    expect(getComputedStyle(ownActions).flexShrink).toBe("0");
    expect(getComputedStyle(ownActions).flexWrap).toBe("nowrap");
    const roomy = await render(<Moment art={<Art />} title="Roomy" />);
    const size = (host: Element) => parseFloat(getComputedStyle(host.querySelector("h3")!).fontSize);
    expect(size(own.moment!)).toBeLessThan(size(roomy.moment!));
    expect(warn).not.toHaveBeenCalled();
    const provided = await render(
      <MomentProvider quiet>
        <Moment art={<Art />} title="Quiet" />
        <Moment art={<Art />} title="Loud" quiet={false} />
      </MomentProvider>,
    );
    const [quiet, loud] = [...provided.host.querySelectorAll<HTMLElement>('[data-ouro="moment"]')];
    expect(quiet!.hasAttribute("data-quiet")).toBe(true);
    expect(loud!.hasAttribute("data-quiet")).toBe(false);
    const plain = await render(
      <MomentProvider>
        <Moment title="Default" />
      </MomentProvider>,
    );
    expect(plain.moment!.hasAttribute("data-quiet")).toBe(false);
    await act(async () =>
      plain.root.render(
        <MomentProvider quiet>
          <Moment title="Default" />
        </MomentProvider>,
      ),
    );
    expect(plain.moment!.hasAttribute("data-quiet")).toBe(true);
  });

  it("keeps its words and drops its art and celebration under OuroProvider's quiet, unless MomentProvider or the prop says otherwise", async () => {
    const { host } = await render(
      <OuroProvider quiet>
        <Moment kind="success" art={<Art />} title="All caught up" description="Nothing needs you." />
        <MomentProvider quiet={false}>
          <Moment kind="success" art={<Art />} title="Provided" />
        </MomentProvider>
        <MomentProvider>
          <Moment kind="success" art={<Art />} title="Passed through" />
        </MomentProvider>
        <Moment quiet={false} kind="success" art={<Art />} title="Own" />
        <Moment kind="loading" title="Syncing" />
      </OuroProvider>,
    );
    await frames(3);
    const [quiet, provided, passed, own, loading] = [...host.querySelectorAll<HTMLElement>('[data-ouro="moment"]')];
    expect(quiet!.getAttribute("data-quiet")).toBe("");
    expect(quiet!.querySelector("[data-ouro-moment-frame]")).toBeNull();
    expect(quiet!.hasAttribute("data-celebrate")).toBe(false);
    expect(quiet!.textContent).toBe("All caught upNothing needs you.");
    expect(passed!.hasAttribute("data-quiet")).toBe(true);
    for (const loud of [provided!, own!]) {
      expect(loud.hasAttribute("data-quiet")).toBe(false);
      expect(loud.querySelector("[data-ouro-moment-frame]")).not.toBeNull();
      expect(loud.hasAttribute("data-celebrate")).toBe(true);
    }
    expect(loading!.querySelector('[data-ouro="spinner"]')).not.toBeNull();
  });

  it("never celebrates when quiet or inline", async () => {
    const quiet = await render(<Moment quiet kind="success" art={<Art />} title="Done" />);
    const inline = await render(<Moment size="inline" kind="success" art={<Art />} title="Done" />);
    await frames(3);
    expect(quiet.moment!.hasAttribute("data-celebrate")).toBe(false);
    expect(inline.moment!.hasAttribute("data-celebrate")).toBe(false);
  });
});

describe("Moment motion", () => {
  it("swells the disc and grows the sparks when it celebrates, and with reduced motion only fades the disc", async () => {
    for (const reduced of [false, true]) {
      await commands.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      const { moment, host, root } = await render(<Moment kind="loading" art={<Art />} title="Sending" />);
      await frames();
      expect(moment!.hasAttribute("data-open")).toBe(false);
      const opened = attributeAdded(moment!, "data-open");
      await act(async () => root.render(<Moment kind="success" art={<Art />} title="All caught up" />));
      await opened;
      const halo = host.querySelector<HTMLElement>('[data-ouro-part="halo"]')!;
      const spark = host.querySelector<HTMLElement>('[data-ouro-part="sparkle"]')!;
      const sheet = token("--ouro-duration-sheet");
      await Promise.all([
        expectMotion(halo, { stem: "moment", state: "data-open", properties: reduced ? { opacity: sheet } : { opacity: sheet, transform: sheet }, reduced }),
        reduced
          ? expectNoMotion(spark, { stem: "moment", state: "data-open", reduced })
          : expectMotion(spark, { stem: "moment", state: "data-open", properties: { transform: sheet, opacity: token("--ouro-duration-slow") }, reduced }),
      ]);
      expect(moment!.hasAttribute("data-celebrate")).toBe(true);
      expect(getComputedStyle(halo).opacity).toBe("0");
      if (reduced) expect(getComputedStyle(spark).display).toBe("none");
      else expect(getComputedStyle(spark).opacity).toBe("0");
    }
  });

  it("celebrates a welcome when asked, and a success only when not told otherwise", async () => {
    const welcome = await render(<Moment kind="welcome" celebrate art={<Art />} title="Welcome" id="welcome-a" />);
    const plain = await render(<Moment kind="success" celebrate={false} art={<Art />} title="Done" />);
    await expect.poll(() => welcome.moment!.hasAttribute("data-celebrate")).toBe(true);
    expect(plain.moment!.hasAttribute("data-celebrate")).toBe(false);
    // A new key on the same moment is still the same appearance: no second flourish starts.
    await act(async () => welcome.root.render(<Moment kind="welcome" celebrate art={<Art />} title="Welcome" id="welcome-b" cap={{ times: 1, per: "day" }} />));
    await frames();
    expect(welcome.moment!.hasAttribute("data-celebrate")).toBe(true);
    expect(localStorage.getItem("ouro-moment:shown:welcome-b")).toBeNull();
  });

  it("never celebrates or speaks a moment that was dismissed", async () => {
    localStorage.setItem("ouro-moment:dismissed:done-before", "1");
    const announced = watchAnnouncements();
    try {
      const { host } = await render(<Moment kind="success" announce art={<Art />} title="Done before" dismissKey="done-before" />);
      await render(<Moment kind="error" announce title="Spoken after" />);
      await expect.poll(() => announced.count("Spoken after")).toBe(1);
      expect(host.querySelector('[data-ouro="moment"]')).toBeNull();
      expect(announced.count("Done before")).toBe(0);
    } finally {
      announced.stop();
    }
  });

  it("celebrates again when it turns into a success a second time", async () => {
    const { root, moment } = await render(<Moment kind="loading" art={<Art />} title="Sending" />);
    await act(async () => root.render(<Moment kind="success" art={<Art />} title="Sent" />));
    await expect.poll(() => moment!.hasAttribute("data-celebrate")).toBe(true);
    await act(async () => root.render(<Moment kind="loading" art={<Art />} title="Sending" />));
    expect(moment!.hasAttribute("data-celebrate")).toBe(false);
    await frames();
    // The celebration starts a frame after the moment turns into a success, not with it.
    flushSync(() => root.render(<Moment kind="success" art={<Art />} title="Sent" />));
    expect(moment!.hasAttribute("data-celebrate")).toBe(false);
    await expect.poll(() => moment!.hasAttribute("data-celebrate")).toBe(true);
  });

  it("stops the art's CSS animations and pauses its SVG animations with reduced motion, and lets them run again after", async () => {
    const style = document.createElement("style");
    style.textContent = "@keyframes ouro-test-moment-bob { to { translate: 0 4px; } } .ouro-test-moment-bob { animation: ouro-test-moment-bob 1s infinite alternate; }";
    document.head.append(style);
    mounted.push(style);
    const { host } = await render(
      <Moment
        title="Moving art"
        art={
          <svg viewBox="0 0 160 120">
            <circle className="ouro-test-moment-bob" cx="80" cy="60" r="20" fill="currentColor">
              <animate attributeName="r" from="20" to="24" dur="1s" repeatCount="indefinite" />
            </circle>
          </svg>
        }
      />,
    );
    const svg = host.querySelector("svg")!;
    const circle = host.querySelector("circle")!;
    expect(getComputedStyle(circle).animationName).toBe("ouro-test-moment-bob");
    expect(svg.animationsPaused()).toBe(false);
    await commands.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(() => svg.animationsPaused()).toBe(true);
    expect(getComputedStyle(circle).animationName).toBe("none");
    await commands.emulateMedia({ reducedMotion: "no-preference" });
    await expect.poll(() => svg.animationsPaused()).toBe(false);
    expect(getComputedStyle(circle).animationName).toBe("ouro-test-moment-bob");
  });

  it("follows OuroProvider's motion over the device: reduced holds the art still, full lets its SVG run", async () => {
    await commands.emulateMedia({ reducedMotion: "no-preference" });
    const still = await render(
      <OuroProvider motion="reduced">
        <Moment kind="loading" title="Still art" art={<Art />} />
      </OuroProvider>,
    );
    await expect.poll(() => still.host.querySelector<SVGSVGElement>("[data-ouro-moment-art] svg")!.animationsPaused()).toBe(true);
    await commands.emulateMedia({ reducedMotion: "reduce" });
    const moving = await render(
      <OuroProvider motion="full">
        <Moment kind="loading" title="Moving art" art={<Art />} />
      </OuroProvider>,
    );
    expect(moving.host.querySelector<SVGSVGElement>("[data-ouro-moment-art] svg")!.animationsPaused()).toBe(false);
  });

  it("pauses SVG art that appears while reduced motion is already on", async () => {
    await commands.emulateMedia({ reducedMotion: "reduce" });
    const { root, host } = await render(<Moment kind="loading" title="No art yet" />);
    expect(host.querySelector("[data-ouro-moment-frame]")).toBeNull();
    await act(async () => root.render(<Moment kind="loading" title="Art now" art={<Art />} />));
    await expect.poll(() => host.querySelector<SVGSVGElement>("[data-ouro-moment-art] svg")!.animationsPaused()).toBe(true);
  });
});

describe("Moment motion budget", () => {
  function animated(css: string) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    mounted.push(style);
  }

  it("settles the art's loops at the end of their turn within 5 s, SVG animations too, and leaves other motion alone", async () => {
    animated(
      "@keyframes ouro-test-moment-spin { to { rotate: 1turn; } } .ouro-test-moment-loop { animation: ouro-test-moment-spin 0.2s linear infinite; }" +
        "@keyframes ouro-test-moment-glow { to { opacity: 0.5; } } .ouro-test-moment-once { animation: ouro-test-moment-glow 60s linear 2; }",
    );
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { host } = await render(
        <Moment
          kind="loading"
          title="Working"
          art={
            <svg viewBox="0 0 160 120">
              <circle className="ouro-test-moment-loop" cx="80" cy="60" r="20" />
              <rect className="ouro-test-moment-once" width="10" height="10" />
              <circle cx="20" cy="20" r="4">
                <animate attributeName="r" values="4;8;4" dur="1s" repeatCount="indefinite" />
              </circle>
            </svg>
          }
        />,
      );
      const loop = host.querySelector(".ouro-test-moment-loop")!.getAnimations()[0]!;
      const once = host.querySelector(".ouro-test-moment-once")!.getAnimations()[0]!;
      const svg = host.querySelector("svg")!;
      svg.setCurrentTime(0.5);
      await act(async () => void vi.advanceTimersByTime(4900));
      expect(loop.effect!.getComputedTiming().endTime).toBe(Infinity);
      expect(svg.getCurrentTime()).toBeGreaterThan(0);
      expect(svg.animationsPaused()).toBe(false);
      await act(async () => void vi.advanceTimersByTime(100));
      expect(loop.effect!.getComputedTiming().iterations).toBe(loop.effect!.getComputedTiming().currentIteration! + 1);
      expect(svg.animationsPaused()).toBe(true);
      expect(svg.getCurrentTime()).toBe(0);
      expect(once.playState).toBe("running");
      expect(once.effect!.getComputedTiming().iterations).toBe(2);
    } finally {
      vi.useRealTimers();
    }
    const loopElement = document.querySelector(".ouro-test-moment-loop")!;
    await expect.poll(() => loopElement.getAnimations().length).toBe(0);
  });

  it("settles again when the art or the kind changes, and stops counting once gone", async () => {
    animated("@keyframes ouro-test-moment-spin2 { to { rotate: 1turn; } } .ouro-test-moment-loop2 { animation: ouro-test-moment-spin2 0.2s linear infinite; }");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const art = (
        <svg viewBox="0 0 160 120">
          <circle className="ouro-test-moment-loop2" cx="80" cy="60" r="20" />
        </svg>
      );
      const { root, host } = await render(<Moment kind="loading" title="Working" art={art} />);
      await act(async () => void vi.advanceTimersByTime(3000));
      await act(async () => root.render(<Moment kind="success" celebrate={false} title="Done" art={art} />));
      await act(async () => void vi.advanceTimersByTime(3000));
      expect(host.querySelector(".ouro-test-moment-loop2")!.getAnimations()[0]!.effect!.getComputedTiming().endTime).toBe(Infinity);
      await act(async () => void vi.advanceTimersByTime(2000));
      expect(host.querySelector(".ouro-test-moment-loop2")!.getAnimations()[0]!.effect!.getComputedTiming().endTime).not.toBe(Infinity);
      await act(async () => root.render(<Moment kind="empty" title="Nothing" />));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("plays the art's entrance once a session for a moment with a key, and every time without one", async () => {
    animated(
      "@keyframes ouro-test-moment-in { from { opacity: 0; } } .ouro-test-moment-in { animation: ouro-test-moment-in 30s linear; }" +
        "@keyframes ouro-test-moment-bob3 { to { translate: 0 2px; } } .ouro-test-moment-bob3 { animation: ouro-test-moment-bob3 1s infinite alternate; }",
    );
    for (const key of Object.keys(sessionStorage)) if (key.startsWith("ouro-moment:")) sessionStorage.removeItem(key);
    const art = (
      <svg viewBox="0 0 160 120">
        <circle className="ouro-test-moment-in" cx="80" cy="60" r="20" />
        <circle className="ouro-test-moment-bob3" cx="20" cy="20" r="4" />
      </svg>
    );
    const entrance = (host: Element) => host.querySelector(".ouro-test-moment-in")!.getAnimations().length;
    const first = await render(<Moment id="welcome-in" title="Welcome" art={art} />);
    expect(entrance(first.host)).toBe(1);
    expect(sessionStorage.getItem("ouro-moment:seen:welcome-in")).toBe("1");
    const again = await render(<Moment id="welcome-in" title="Welcome" art={art} />);
    expect(entrance(again.host)).toBe(0);
    // A loop is not an entrance: it keeps running, until it settles.
    expect(again.host.querySelector(".ouro-test-moment-bob3")!.getAnimations()).toHaveLength(1);
    const byDismissKey = await render(<Moment dismissKey="tour-in" title="Tour" art={art} />);
    expect(entrance(byDismissKey.host)).toBe(1);
    expect(entrance((await render(<Moment dismissKey="tour-in" title="Tour" art={art} />)).host)).toBe(0);
    for (let index = 0; index < 2; index++) expect(entrance((await render(<Moment title="Keyless" art={art} />)).host)).toBe(1);
  });

  it("asks once per key whether its entrance played, so StrictMode's second run still plays it, and finishes new art under a key already shown", async () => {
    animated(
      "@keyframes ouro-test-moment-in3 { from { opacity: 0; } } .ouro-test-moment-in3 { animation: ouro-test-moment-in3 30s linear; }" +
        "@keyframes ouro-test-moment-in4 { from { scale: 0.5; } } .ouro-test-moment-in4 { animation: ouro-test-moment-in4 30s linear; }",
    );
    for (const key of Object.keys(sessionStorage)) if (key.startsWith("ouro-moment:")) sessionStorage.removeItem(key);
    const art = (name: string) => (
      <svg viewBox="0 0 160 120">
        <circle className={name} cx="80" cy="60" r="20" />
      </svg>
    );
    const entrance = (host: Element, name: string) => host.querySelector(`.${name}`)!.getAnimations().length;
    const strict = await render(
      <StrictMode>
        <Moment id="strict-in" title="Welcome" art={art("ouro-test-moment-in3")} />
      </StrictMode>,
    );
    expect(entrance(strict.host, "ouro-test-moment-in3")).toBe(1);
    // The same moment turns to a key already shown: its running entrance finishes.
    sessionStorage.setItem("ouro-moment:seen:shown-in", "1");
    await act(async () => strict.root.render(<StrictMode><Moment id="shown-in" title="Welcome" art={art("ouro-test-moment-in3")} /></StrictMode>));
    expect(entrance(strict.host, "ouro-test-moment-in3")).toBe(0);
    // New art under that key enters already finished too.
    await act(async () => strict.root.render(<StrictMode><Moment id="shown-in" title="Welcome" art={art("ouro-test-moment-in4")} /></StrictMode>));
    expect(entrance(strict.host, "ouro-test-moment-in4")).toBe(0);
  });

  it("remembers what it has shown for the page where the browser refuses session storage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    animated("@keyframes ouro-test-moment-in2 { from { opacity: 0; } } .ouro-test-moment-in2 { animation: ouro-test-moment-in2 30s linear; }");
    const art = (
      <svg viewBox="0 0 160 120">
        <circle className="ouro-test-moment-in2" cx="80" cy="60" r="20" />
      </svg>
    );
    const entrance = (host: Element) => host.querySelector(".ouro-test-moment-in2")!.getAnimations().length;
    expect(entrance((await render(<Moment id="private-in" title="Hello" art={art} />)).host)).toBe(1);
    expect(entrance((await render(<Moment id="private-in" title="Hello" art={art} />)).host)).toBe(0);
  });
});

describe("Moment ask", () => {
  it("docks in the slot it is given as one row, is heard when asked, and comes back after dismissFor", async () => {
    let now = Date.UTC(2026, 10, 1, 12);
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const announced = watchAnnouncements();
    const ask = (
      <header style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span>Launch planning</span>
        <Moment
          kind="ask"
          size="inline"
          announce
          art={<Art />}
          title="Planner wants to show you the launch plan"
          action={<Button size="sm">Show me</Button>}
          dismissKey="planner-launch"
          dismissFor="hour"
          dismissLabel="Not now"
        />
      </header>
    );
    try {
      const { host } = await render(ask);
      const moment = host.querySelector<HTMLElement>('[data-ouro="moment"]')!;
      expect(moment.getAttribute("data-moment")).toBe("ask");
      expect(["static", "relative"]).toContain(getComputedStyle(moment).position);
      expect(getComputedStyle(moment).flexDirection).toBe("row");
      expect(moment.getBoundingClientRect().height).toBeLessThan(48);
      expect(getComputedStyle(host.querySelector("[data-ouro-moment-frame]")!).color).toBe(colourOf("var(--primary)"));
      await expect.poll(() => announced.count("Planner wants to show you the launch plan")).toBe(1);
      await userEvent.click(page.getByRole("button", { name: "Not now" }));
      expect(host.querySelector('[data-ouro="moment"]')).toBeNull();
      expect(localStorage.getItem("ouro-moment:dismissed:planner-launch")).toBe(String(now));
      now += 60 * 60 * 1000 - 1;
      expect((await render(ask)).host.querySelector('[data-ouro="moment"]')).toBeNull();
      now += 1;
      expect((await render(ask)).host.querySelector('[data-ouro="moment"]')).not.toBeNull();
    } finally {
      announced.stop();
    }
  });

  it("moves its actions under its words in a slot too narrow for both, so the words keep their room", async () => {
    const node = (
      <Moment kind="ask" size="inline" art={<Art />} title="Planner wants to show you the launch plan" action={<Button size="sm">Show me</Button>} onDismiss={() => {}} />
    );
    const wide = await render(node, 640);
    const narrow = await render(node, 300);
    const row = (host: Element) => {
      const title = host.querySelector("[data-ouro-moment-actions]")!.previousElementSibling!.getBoundingClientRect();
      const actions = host.querySelector("[data-ouro-moment-actions]")!.getBoundingClientRect();
      return { title, actions };
    };
    expect(row(wide.host).actions.top).toBeLessThan(row(wide.host).title.bottom);
    expect(row(narrow.host).actions.top).toBeGreaterThanOrEqual(row(narrow.host).title.bottom);
    expect(row(narrow.host).title.width).toBeGreaterThan(200);
  });

  it("keeps a dismissal for good without dismissFor, and one made for good stays so with it", async () => {
    let now = Date.UTC(2026, 10, 1, 12);
    vi.spyOn(Date, "now").mockImplementation(() => now);
    localStorage.setItem("ouro-moment:dismissed:for-good", "1");
    now += 365 * 24 * 60 * 60 * 1000;
    expect((await render(<Moment kind="ask" title="Look" dismissKey="for-good" dismissFor="week" />)).moment).toBeNull();
    for (const [dismissFor, ms] of [
      ["day", 24 * 60 * 60 * 1000],
      ["week", 7 * 24 * 60 * 60 * 1000],
      ["month", 30 * 24 * 60 * 60 * 1000],
      ["year", 24 * 60 * 60 * 1000],
    ] as const) {
      localStorage.setItem(`ouro-moment:dismissed:${dismissFor}`, String(now - ms + 1));
      const node = <Moment kind="ask" title="Look" dismissKey={dismissFor} {...({ dismissFor } as object)} />;
      expect((await render(node)).moment).toBeNull();
      localStorage.setItem(`ouro-moment:dismissed:${dismissFor}`, String(now - ms));
      expect((await render(node)).moment).not.toBeNull();
    }
  });
});

describe("Moment cap", () => {
  const day = 24 * 60 * 60 * 1000;

  async function celebrates(node: ReactNode): Promise<boolean> {
    const { moment, root } = await render(node);
    await frames(3);
    const result = moment!.hasAttribute("data-celebrate");
    await act(async () => root.unmount());
    roots.splice(roots.indexOf(root), 1);
    return result;
  }

  it("celebrates at most times per period, then again once the period has passed", async () => {
    let now = Date.UTC(2026, 9, 31, 12);
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const moment = <Moment kind="success" art={<Art />} title="All caught up" dismissKey="caught-up" cap={{ times: 2, per: "day" }} />;
    expect(await celebrates(moment)).toBe(true);
    now += 1000;
    expect(await celebrates(moment)).toBe(true);
    now += 1000;
    expect(await celebrates(moment)).toBe(false);
    expect(JSON.parse(localStorage.getItem("ouro-moment:shown:caught-up")!)).toHaveLength(2);
    now += day;
    expect(await celebrates(moment)).toBe(true);
    expect(JSON.parse(localStorage.getItem("ouro-moment:shown:caught-up")!)).toEqual([now]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("counts by id without a dismissKey, keeps ever for good, and never celebrates at times 0", async () => {
    let now = Date.UTC(2026, 9, 31, 12);
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const once = <Moment id="first-send" kind="success" art={<Art />} title="First message sent" cap={{ times: 1, per: "ever" }} />;
    expect(await celebrates(once)).toBe(true);
    now += 400 * day;
    expect(await celebrates(once)).toBe(false);
    expect(localStorage.getItem("ouro-moment:shown:first-send")).not.toBeNull();
    expect(await celebrates(<Moment id="never" kind="success" art={<Art />} title="Done" cap={{ times: 0, per: "week" }} />)).toBe(false);
    const week = <Moment id="weekly" kind="success" art={<Art />} title="Done" cap={{ times: 1, per: "week" }} />;
    expect(await celebrates(week)).toBe(true);
    now += 6 * day;
    expect(await celebrates(week)).toBe(false);
    now += day + 1;
    expect(await celebrates(week)).toBe(true);
    const month = <Moment id="monthly" kind="success" art={<Art />} title="Done" cap={{ times: 1, per: "month" }} />;
    expect(await celebrates(month)).toBe(true);
    now += 29 * day;
    expect(await celebrates(month)).toBe(false);
    now += day + 1;
    expect(await celebrates(month)).toBe(true);
  });

  it("reads past a stored value it cannot use, and ignores showings from the future", async () => {
    const now = Date.UTC(2026, 9, 31, 12);
    vi.spyOn(Date, "now").mockReturnValue(now);
    const moment = (key: string) => <Moment dismissKey={key} kind="success" art={<Art />} title="Done" cap={{ times: 1, per: "day" }} />;
    localStorage.setItem("ouro-moment:shown:broken", "{not json");
    expect(await celebrates(moment("broken"))).toBe(true);
    localStorage.setItem("ouro-moment:shown:object", '{"a":1}');
    expect(await celebrates(moment("object"))).toBe(true);
    localStorage.setItem("ouro-moment:shown:odd", JSON.stringify(["yesterday", now + day]));
    expect(await celebrates(moment("odd"))).toBe(true);
    expect(JSON.parse(localStorage.getItem("ouro-moment:shown:odd")!)).toEqual([now]);
    // A showing at this very moment counts; one exactly a period ago has run out.
    localStorage.setItem("ouro-moment:shown:now", JSON.stringify([now]));
    expect(await celebrates(moment("now"))).toBe(false);
    localStorage.setItem("ouro-moment:shown:edge", JSON.stringify([now - day]));
    expect(await celebrates(moment("edge"))).toBe(true);
    // A time written as text is no showing.
    localStorage.setItem("ouro-moment:shown:text", JSON.stringify([String(now)]));
    expect(await celebrates(moment("text"))).toBe(true);
  });

  it("counts an unknown period as a day, and times that are no whole number as once", async () => {
    let now = Date.UTC(2026, 9, 31, 12);
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const hourly = <Moment id="hourly" kind="success" art={<Art />} title="Done" {...({ cap: { times: 1, per: "hour" } } as unknown as object)} />;
    expect(await celebrates(hourly)).toBe(true);
    now += 2 * 60 * 60 * 1000;
    expect(await celebrates(hourly)).toBe(false);
    now += day;
    expect(await celebrates(hourly)).toBe(true);
    const half = <Moment id="half" kind="success" art={<Art />} title="Done" cap={{ times: 1.5, per: "day" }} />;
    expect(await celebrates(half)).toBe(true);
    expect(await celebrates(half)).toBe(false);
    const below = <Moment id="below" kind="success" art={<Art />} title="Done" cap={{ times: -1, per: "day" }} />;
    expect(await celebrates(below)).toBe(true);
    expect(await celebrates(below)).toBe(false);
  });

  it("celebrates every time without a cap, or without a key to count under", async () => {
    const moment = <Moment dismissKey="uncapped" kind="success" art={<Art />} title="Done" />;
    expect(await celebrates(moment)).toBe(true);
    expect(await celebrates(moment)).toBe(true);
    expect(localStorage.getItem("ouro-moment:shown:uncapped")).toBeNull();
    const keyless = <Moment kind="success" art={<Art />} title="Done" cap={{ times: 1, per: "day" }} />;
    expect(await celebrates(keyless)).toBe(true);
    expect(await celebrates(keyless)).toBe(true);
  });

  it("keeps counting in memory where the browser refuses storage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const moment = <Moment id="private-window" kind="success" art={<Art />} title="Done" cap={{ times: 1, per: "day" }} />;
    expect(await celebrates(moment)).toBe(true);
    expect(await celebrates(moment)).toBe(false);
  });
});

describe("Moment dismissal", () => {
  it("closes from the keyboard, calls onDismiss and hands focus on", async () => {
    const onDismiss = vi.fn();
    await render(
      <div>
        <Moment kind="welcome" art={<Art />} title="Welcome" onDismiss={onDismiss} />
        <button type="button">Next</button>
      </div>,
    );
    const close = page.getByRole("button", { name: "Dismiss" });
    (close.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-ouro="moment"]')).toBeNull();
    await expect.poll(() => document.activeElement?.textContent).toBe("Next");
    expect(Object.keys(localStorage).filter((key) => key.startsWith("ouro-moment:"))).toEqual([]);
  });

  it("puts the close button in the corner, clear of the art, or at the end of a row", async () => {
    const { moment, frame } = await render(<Moment art={<Art />} title="Welcome" dismissKey="corner" dismissLabel="Close" />);
    const close = page.getByRole("button", { name: "Close" }).element() as HTMLElement;
    expect(close.querySelector("svg")).not.toBeNull();
    expect(getComputedStyle(close).position).toBe("absolute");
    expect(getComputedStyle(moment!).paddingTop).toBe("48px");
    const undismissible = await render(<Moment art={<Art />} title="Welcome" />);
    expect(getComputedStyle(undismissible.moment!).paddingTop).toBe("32px");
    expect(close.getBoundingClientRect().bottom).toBeLessThanOrEqual(frame!.getBoundingClientRect().top + 0.5);
    expect(close.getBoundingClientRect().right).toBeLessThanOrEqual(moment!.getBoundingClientRect().right);
    const row = await render(<Moment quiet art={<Art />} title="Welcome" onDismiss={() => {}} />);
    const rowClose = row.moment!.querySelector<HTMLElement>('[data-ouro-part="dismiss"]')!;
    expect(getComputedStyle(row.moment!).paddingTop).not.toBe("48px");
    expect(getComputedStyle(rowClose).position).toBe("relative");
    expect(rowClose.getBoundingClientRect().left).toBeGreaterThan(row.moment!.querySelector("h3")!.getBoundingClientRect().left);
    expect(rowClose.getAttribute("data-ouro-control")).toBe("moment");
  });

  it("never reads a dismissal for a moment without a dismissKey", async () => {
    localStorage.setItem("ouro-moment:dismissed:undefined", "1");
    const { moment } = await render(<Moment title="Keyless" />);
    expect(moment).not.toBeNull();
  });

  it("has no close button unless it can be dismissed", async () => {
    const { moment } = await render(<Moment title="Welcome" />);
    expect(moment!.querySelector('[data-ouro-part="dismiss"]')).toBeNull();
  });

  it("stays dismissed through dismissKey, after a remount and in another tab", async () => {
    const first = await render(<Moment kind="welcome" title="Welcome" dismissKey="welcome-tour" />);
    await userEvent.click(page.getByRole("button", { name: "Dismiss" }));
    expect(first.moment).toBeNull();
    expect(localStorage.getItem("ouro-moment:dismissed:welcome-tour")).toBe("1");
    const again = await render(<Moment kind="welcome" title="Welcome" dismissKey="welcome-tour" />);
    expect(again.moment).toBeNull();
    const other = await render(<Moment kind="welcome" title="Tips" dismissKey="tips" />);
    expect(other.moment).not.toBeNull();
    localStorage.setItem("ouro-moment:dismissed:tips", "1");
    await act(async () => void window.dispatchEvent(new StorageEvent("storage", { key: "ouro-moment:dismissed:tips" })));
    expect(other.moment).toBeNull();
  });

  it("stops listening once it is gone", async () => {
    const gone = await render(<Moment title="Gone" dismissKey="gone" />);
    await act(async () => gone.root.unmount());
    roots.splice(roots.indexOf(gone.root), 1);
    await render(<Moment title="Other" dismissKey="other" />);
    const reads = vi.spyOn(Storage.prototype, "getItem");
    await userEvent.click(page.getByRole("button", { name: "Dismiss" }));
    await act(async () => void window.dispatchEvent(new StorageEvent("storage", { key: "ouro-moment:dismissed:other" })));
    expect(reads.mock.calls.some(([key]) => key === "ouro-moment:dismissed:gone")).toBe(false);
    expect(reads.mock.calls.some(([key]) => key === "ouro-moment:dismissed:other")).toBe(true);
  });

  it("closes every copy of a moment on the page at once", async () => {
    const { host } = await render(
      <>
        <Moment title="Tip" dismissKey="shared-tip" />
        <Moment title="Tip again" dismissKey="shared-tip" />
      </>,
    );
    await userEvent.click(page.getByRole("button", { name: "Dismiss" }).first());
    expect(host.querySelector('[data-ouro="moment"]')).toBeNull();
  });

  it("keeps a dismissal in memory where the browser refuses storage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    await render(<Moment title="Private" dismissKey="private-tip" />);
    await userEvent.click(page.getByRole("button", { name: "Dismiss" }));
    const again = await render(<Moment title="Private" dismissKey="private-tip" />);
    expect(again.moment).toBeNull();
  });

  it("renders nothing on the server with a dismissKey, and everything without one", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(renderToString(<Moment title="Welcome" dismissKey="server" />)).toBe("");
    const html = renderToString(<Moment kind="success" art={<Art />} title="No messages yet" description="Add one." className="text-red-500" />);
    expect(html).toContain('data-ouro="moment"');
    expect(html).toContain('data-moment="success"');
    expect(html).not.toContain("data-celebrate");
    expect(html).toContain("<h3");
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("shows a server-rendered moment with a dismissKey once it hydrates, unless it was dismissed", async () => {
    const { hydrateRoot } = await import("react-dom/client");
    for (const [dismissed, expected] of [
      [false, true],
      [true, false],
    ] as const) {
      if (dismissed) localStorage.setItem("ouro-moment:dismissed:hydrated", "1");
      const node = (
        <div>
          <Moment title="Welcome" dismissKey="hydrated" />
        </div>
      );
      const host = document.createElement("div");
      host.innerHTML = renderToString(node);
      document.body.append(host);
      mounted.push(host);
      let root: Root | undefined;
      await act(async () => void (root = hydrateRoot(host, node)));
      roots.push(root!);
      expect(host.querySelector('[data-ouro="moment"]') !== null).toBe(expected);
    }
  });

  it("keeps its own state when the app keeps rendering it after a dismissal without a key", async () => {
    function Host() {
      const [count, setCount] = useState(0);
      return (
        <>
          <Moment title="Tip" onDismiss={() => setCount(count + 1)} />
          <p>Dismissed {count}</p>
        </>
      );
    }
    await render(<Host />);
    await userEvent.click(page.getByRole("button", { name: "Dismiss" }));
    await expect.element(page.getByText("Dismissed 1")).toBeVisible();
    expect(document.querySelector('[data-ouro="moment"]')).toBeNull();
  });
});

describe("Moment development messages", () => {
  it.each([
    ["kind", { title: "x", kind: "info" }, 'kind="info" is not a kind; use "empty", "loading", "error", "first-run", "success", "ask"', '<Moment kind="empty">'],
    ["size", { title: "x", size: "small" }, 'size="small" is not a size; use "default", "hero", "inline"', "<Moment quiet>"],
    ["headingLevel", { title: "x", headingLevel: 1 }, "headingLevel must be 2, 3, 4, 5 or 6, got 1", "<Moment headingLevel={2}>"],
    ["cap per", { title: "x", id: "a", cap: { times: 1, per: "hour" } }, 'cap per "hour" is not a period; use "day", "week", "month", "ever"', '<Moment cap={{ times: 1, per: "day" }}>'],
    ["cap times", { title: "x", id: "a", cap: { times: 1.5, per: "day" } }, "cap times must be a whole number, 0 or more, got 1.5", '<Moment cap={{ times: 1, per: "day" }}>'],
    ["cap key", { title: "x", cap: { times: 1, per: "day" } }, "cap counts showings under dismissKey or id, and this moment has neither", '<Moment dismissKey="caught-up" cap={{ times: 1, per: "day" }}>'],
    ["announce", { title: "x", kind: "welcome", announce: true }, 'announce speaks only success, error and ask moments, not kind="first-run"', '<Moment kind="success" announce>'],
    ["dismissFor", { title: "x", dismissKey: "a", dismissFor: "year" }, 'dismissFor="year" is not a period; use "hour", "day", "week", "month"', '<Moment dismissKey="ask" dismissFor="day">'],
    ["dismissFor without a key", { title: "x", dismissFor: "day" }, "dismissFor keeps a dismissal through dismissKey, and this moment has none", '<Moment dismissKey="ask" dismissFor="day">'],
    ["icon", { title: "x", icon: "i" }, "icon is not a prop", "<Moment art={<Illustration />}>"],
    ["illustration", { title: "x", illustration: "i" }, "illustration is not a prop", "<Moment art={<Illustration />}>"],
    ["heading", { title: "x", heading: "No messages" }, "heading is not a prop", '<Moment title="No messages">'],
    ["body", { title: "x", body: "Add one" }, "body is not a prop", '<Moment description="Add one">'],
    ["actions", { title: "x", actions: "y" }, "actions is not a prop", "<Moment action={<Button>…</Button>} secondaryAction={<Button>…</Button>}>"],
    ["onClose", { title: "x", onClose: () => {} }, "onClose is not a prop", "<Moment onDismiss={() => setOpen(false)}>"],
    ["variant", { title: "x", variant: "success" }, "variant is not a prop", '<Moment kind="success">'],
    ["variant, unknown", { title: "x", variant: "destructive" }, "variant is not a prop", '<Moment kind="error">'],
  ])("names the fix for %s", async (_name, props, problem, fix) => {
    const { moment } = await render(<Moment {...(props as unknown as Parameters<typeof Moment>[0])} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Moment: ${problem}. Fix: ${fix}.`);
    for (const name of ["icon", "illustration", "heading", "body", "actions", "variant"]) expect(moment!.hasAttribute(name)).toBe(false);
  });

  it("renders the defaults for what it does not know", async () => {
    const { moment } = await render(
      <Moment {...({ title: "Nothing", kind: "info", size: "small", headingLevel: 9, id: "fallback", cap: { times: -1, per: "hour" } } as unknown as Parameters<typeof Moment>[0])} />,
    );
    expect(moment!.getAttribute("data-moment")).toBe("empty");
    expect(getComputedStyle(moment!).flexDirection).toBe("column");
    await expect.element(page.getByRole("heading", { level: 3, name: "Nothing" })).toBeVisible();
  });

  it("asks for a title", async () => {
    await render(<Moment {...({ description: "Nothing yet" } as unknown as Parameters<typeof Moment>[0])} />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] Moment: title is required; it says what the moment is about. Fix: <Moment title="No messages yet">.');
  });

  it("checks the className", async () => {
    await render(<Moment title="Nothing" className="bg-muted" />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] Moment: "bg-muted" sets appearance, and className is for layout only. Fix: remove "bg-muted"; Moment takes its look from kind and quiet.');
  });
});
