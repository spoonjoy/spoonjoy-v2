import { type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Emoji, EmojiText, type EmojiCatalogue, type EmojiItem, type EmojiSkinTone, type EmojiProps, type EmojiTextProps } from "~/components/ouro/emoji/emoji";
import { catalogueIndex, emojiTextToTokens, emojiToken, matchWords, searchCatalogue, splitEmojiText } from "~/components/ouro/emoji/emoji-styles";
import { OuroProvider } from "~/lib/ouro/ouro-provider";
import { act } from "~/lib/ouro/testing/act";
import { parseDuration } from "~/lib/ouro/testing/motion";

// Runs in Chromium and WebKit.

const roots: Root[] = [];
let mounted: Element[] = [];

/** A blank image whose address names it, so a test can tell the images apart. */
const image = (name: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><title>${name}</title></svg>`)}`;

/** A filmstrip of square frames stacked top to bottom, each a different shade, `frames` tall. */
const strip = (name: string, frames: number) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="${32 * frames}" viewBox="0 0 32 ${32 * frames}"><title>${name}</title>${Array.from({ length: frames }, (_, index) => `<rect y="${32 * index}" width="32" height="32" fill="hsl(${index * 60} 80% 50%)"/>`).join("")}</svg>`,
  )}`;
const blink: EmojiItem = { id: "blink", name: "Blinking face", src: image("blink"), width: 32, height: 32, filmstrip: { src: strip("blink", 4), fps: 8 } };

const tones = ["tone1", "tone2", "tone3", "tone4", "tone5"].map((tone, index) => ({
  id: `wave-${tone}`,
  src: image(`wave ${tone}`),
  animatedSrc: image(`wave ${tone} moving`),
  text: `👋${String.fromCodePoint(0x1f3fb + index)}`,
}));
const wave: EmojiItem = { id: "wave", name: "Waving hand", shortcodes: ["wave"], text: "👋", src: image("wave"), animatedSrc: image("wave moving"), skinTones: tones };
const party: EmojiItem = { id: "party", name: "Party popper", shortcodes: ["party", "tada"], text: "🎉", src: image("party"), srcSet: `${image("party 2x")} 2x`, animatedSrc: image("party moving") };
const heart: EmojiItem = { id: "heart", name: "Red heart", text: "❤️", src: image("heart") };
const fern: EmojiItem = { id: "fern", name: "Fernwood fern", shortcodes: ["Fern"], custom: true, src: image("fern") };
/** An id that looks like another emoji's shortcode: the shortcode wins. */
const tada: EmojiItem = { id: "tada", name: "Tada banner", src: image("tada") };
const catalogue: EmojiCatalogue = {
  categories: [
    { id: "people", label: "People", items: [wave, heart] },
    { id: "symbols", label: "Symbols", items: [party, tada, heart] },
    { id: "custom", label: "Fernwood", items: [fern] },
  ],
};

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return { host, rerender: (next: ReactNode) => act(async () => root.render(next)) };
}

const emoji = (host: Element) => host.querySelector<HTMLImageElement>('[data-ouro="emoji"]')!;
const images = (host: Element) => [...host.querySelectorAll<HTMLImageElement>('[data-ouro="emoji"]')];
const messages = () => warn.mock.calls.map((call: unknown[]) => String(call[0]));

let warn: ReturnType<typeof vi.spyOn>;
// Reduced motion for the file, so an emoji under a mouse left resting from elsewhere plays
// nothing; the tests of playing let motion through with `motion()`.
beforeAll(async () => {
  await commands.emulateMedia({ reducedMotion: "reduce" });
});
afterAll(async () => {
  await commands.emulateMedia({ reducedMotion: "no-preference" });
});
/** Lets motion through until the test ends. */
async function motion() {
  await commands.emulateMedia({ reducedMotion: "no-preference" });
  onTestFinished(() => commands.emulateMedia({ reducedMotion: "reduce" }));
}
beforeEach(async () => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  // The mouse rests far from where the test draws, so no emoji there plays for it.
  const corner = document.createElement("div");
  corner.style.cssText = "position:fixed;right:0;bottom:0;width:4px;height:4px";
  document.body.append(corner);
  await userEvent.hover(corner);
  corner.remove();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

describe("Emoji", () => {
  it("draws the still image named by the emoji's name, the size of the text, in the tone asked for", async () => {
    const { host, rerender } = await render(
      <p style={{ fontSize: 20 }}>
        <Emoji item={party} />
      </p>,
    );
    const img = emoji(host);
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toBe(party.src);
    expect(img.getAttribute("srcset")).toBe(party.srcSet);
    expect(img.alt).toBe("Party popper");
    expect(img.getBoundingClientRect().width).toBe(25);
    expect(img.getBoundingClientRect().height).toBe(25);
    expect(img.draggable).toBe(false);
    // Fetched as soon as it is drawn, not when it nears the screen.
    expect(img.hasAttribute("loading")).toBe(false);
    expect(img.getAttribute("decoding")).toBe("async");
    await rerender(<Emoji item={wave} skinTone="medium" />);
    expect(emoji(host).getAttribute("src")).toBe(image("wave tone3"));
    expect(emoji(host).hasAttribute("srcset")).toBe(false);
    expect(emoji(host).alt).toBe("Waving hand");
    await rerender(<Emoji item={party} skinTone="dark" alt="" />);
    expect(emoji(host).getAttribute("src")).toBe(party.src);
    expect(emoji(host).alt).toBe("");
    expect(messages()).toEqual([]);
  });

  it("plays while the mouse is on its button or the button has focus, and stops after", async () => {
    await motion();
    const { host } = await render(
      <>
        <button type="button">
          <span aria-hidden="true">
            <Emoji item={party} />
          </span>
        </button>
        <button type="button">Elsewhere</button>
      </>,
    );
    const [button, elsewhere] = [...host.querySelectorAll("button")];
    expect(emoji(host).getAttribute("src")).toBe(party.src);
    await userEvent.hover(button!);
    await expect.poll(() => emoji(host).getAttribute("src")).toBe(party.animatedSrc);
    expect(emoji(host).hasAttribute("srcset")).toBe(false);
    await userEvent.hover(elsewhere!);
    await expect.poll(() => emoji(host).getAttribute("src")).toBe(party.src);
    expect(emoji(host).getAttribute("srcset")).toBe(party.srcSet);
    await act(async () => button!.focus());
    expect(emoji(host).getAttribute("src")).toBe(party.animatedSrc);
    await act(async () => elsewhere!.focus());
    expect(emoji(host).getAttribute("src")).toBe(party.src);
  });

  it("keeps playing while focus moves within its host, stops when focus or the mouse leaves, and plays for no touch", async () => {
    await motion();
    const { host, rerender } = await render(
      <div role="option" aria-selected="false" tabIndex={0}>
        <Emoji item={party} />
        <input aria-label="Note" />
      </div>,
    );
    const option = host.querySelector<HTMLElement>('[role="option"]')!;
    await act(async () => option.focus());
    expect(emoji(host).getAttribute("src")).toBe(party.animatedSrc);
    await act(async () => host.querySelector("input")!.focus());
    expect(emoji(host).getAttribute("src")).toBe(party.animatedSrc);
    await act(async () => host.querySelector("input")!.blur());
    expect(emoji(host).getAttribute("src")).toBe(party.src);
    await act(async () => void option.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "touch" })));
    expect(emoji(host).getAttribute("src")).toBe(party.src);
    await act(async () => void option.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" })));
    expect(emoji(host).getAttribute("src")).toBe(party.animatedSrc);
    await act(async () => void option.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" })));
    expect(emoji(host).getAttribute("src")).toBe(party.src);
    // Focus that leaves while play is set goes unseen: without play again, the emoji is still.
    await act(async () => option.focus());
    await rerender(
      <div role="option" aria-selected="false" tabIndex={0}>
        <Emoji item={party} play={false} />
        <input aria-label="Note" />
      </div>,
    );
    await act(async () => option.blur());
    await rerender(
      <div role="option" aria-selected="false" tabIndex={0}>
        <Emoji item={party} />
        <input aria-label="Note" />
      </div>,
    );
    expect(emoji(host).getAttribute("src")).toBe(party.src);
  });

  it("plays a filmstrip by stepping through its frames at its fps while its button is under the mouse, and shows the still image after", async () => {
    await motion();
    const { host } = await render(
      <>
        <button type="button">
          <Emoji item={blink} />
        </button>
        <button type="button">Elsewhere</button>
      </>,
    );
    const [button, elsewhere] = [...host.querySelectorAll("button")];
    const img = emoji(host);
    expect(img.getAttribute("src")).toBe(blink.src);
    expect(img.getAttribute("width")).toBe("32");
    expect(img.getAttribute("height")).toBe("32");
    expect(img.getAnimations()).toEqual([]);
    await userEvent.hover(button!);
    await expect.poll(() => img.getAnimations().length).toBe(1);
    expect(img.getAttribute("src")).toBe(blink.filmstrip!.src);
    expect(getComputedStyle(img).objectFit).toBe("cover");
    const [animation] = img.getAnimations();
    const timing = animation!.effect!.getTiming();
    expect(timing.duration).toBe(500);
    expect(timing.iterations).toBe(Infinity);
    expect(timing.easing).toMatch(/^steps\(4, jump-none\)$/);
    expect((animation!.effect as KeyframeEffect).getKeyframes().map((frame) => frame["objectPosition"])).toEqual(["50% 0%", "50% 100%"]);
    await userEvent.hover(elsewhere!);
    await expect.poll(() => img.getAttribute("src")).toBe(blink.src);
    // What any animation left running is, so a failure says which one stayed (ourostack/ouro-ui#905).
    const running = img.getAnimations().map((left) => `${left.constructor.name} ${left.playState} ${JSON.stringify((left.effect as KeyframeEffect | null)?.getKeyframes())}`);
    expect(running).toEqual([]);
    expect(getComputedStyle(img).objectFit).toBe("contain");
  });

  it("stops a filmstrip in the same commit that brings back the still image, never after it", async () => {
    await motion();
    const host = document.createElement("div");
    document.body.append(host);
    mounted.push(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<Emoji item={blink} play />));
    const img = emoji(host);
    await expect.poll(() => img.getAnimations().length).toBe(1);
    // Outside act, React commits on its own task, and passive effects run in a later one; a
    // microtask after the commit sees the DOM as the commit left it.
    const running: number[] = [];
    const observer = new MutationObserver(() => running.push(img.getAnimations().length));
    observer.observe(img, { attributes: true, attributeFilter: ["src"] });
    root.render(<Emoji item={blink} play={false} />);
    await expect.poll(() => img.getAttribute("src")).toBe(blink.src);
    observer.disconnect();
    expect(running).toEqual([0]);
  });

  it("plays an animated image over a filmstrip, a tone's filmstrip in that tone, leaves one frame or a broken strip still, and starts a strip once", async () => {
    await motion();
    const both: EmojiItem = { ...blink, animatedSrc: image("blink moving") };
    const toned: EmojiItem = { ...wave, animatedSrc: undefined, skinTones: tones.map((tone) => ({ ...tone, animatedSrc: undefined, filmstrip: { src: strip(tone.id, 3), fps: 6 } })) };
    const { host, rerender } = await render(<Emoji item={both} play />);
    expect(emoji(host).getAttribute("src")).toBe(both.animatedSrc);
    await rerender(<Emoji item={toned} skinTone="dark" play />);
    expect(emoji(host).getAttribute("src")).toBe(strip("wave-tone5", 3));
    await expect.poll(() => emoji(host).getAnimations()[0]?.effect?.getTiming().duration).toBe(500);
    // One frame is no animation.
    await rerender(<Emoji item={{ ...blink, filmstrip: { src: strip("one", 1), fps: 8 } }} play />);
    await emoji(host).decode();
    await act(async () => {});
    expect(emoji(host).getAnimations()).toEqual([]);
    // A strip that fails to load leaves the image as it is.
    await rerender(<Emoji item={{ ...blink, filmstrip: { src: "data:image/png;base64,AAAA", fps: 8 } }} play />);
    await emoji(host).decode().catch(() => {});
    await act(async () => {});
    expect(emoji(host).getAnimations()).toEqual([]);
    // A strip whose fps changes before it is ready starts once, at the new pace.
    const late = (fps: number) => <Emoji item={{ ...blink, filmstrip: { src: strip("late", 4), fps } }} play />;
    await rerender(late(8));
    await rerender(late(4));
    await expect.poll(() => emoji(host).getAnimations().length).toBe(1);
    await emoji(host).decode();
    await act(async () => {});
    expect(emoji(host).getAnimations().map((animation) => animation.effect!.getTiming().duration)).toEqual([1000]);
    await rerender(<Emoji item={blink} play={false} />);
    expect(emoji(host).getAnimations()).toEqual([]);
    expect(emoji(host).getAttribute("src")).toBe(blink.src);
    // A tall still image is no filmstrip: only a filmstrip that plays is stepped, and nothing fails.
    const rejected = vi.fn();
    window.addEventListener("unhandledrejection", rejected);
    onTestFinished(() => window.removeEventListener("unhandledrejection", rejected));
    const tall = await render(<Emoji item={{ id: "tall", name: "Tall banner", src: strip("tall", 3) }} />);
    await emoji(tall.host).decode();
    await act(async () => {});
    await new Promise(requestAnimationFrame);
    expect(emoji(tall.host).getAnimations()).toEqual([]);
    expect(rejected).not.toHaveBeenCalled();
    // A fresh emoji stopped before its filmstrip is ready stops cleanly.
    const fresh = await render(<Emoji item={{ ...blink, filmstrip: { src: strip("fresh", 4), fps: 8 } }} play />);
    await fresh.rerender(<Emoji item={{ ...blink, filmstrip: { src: strip("fresh", 4), fps: 8 } }} play={false} />);
    expect(emoji(fresh.host).getAttribute("src")).toBe(blink.src);
    expect(emoji(fresh.host).getAnimations()).toEqual([]);
  });

  it("plays and stops with play, plays for the image itself outside a button, and never without an animated image", async () => {
    await motion();
    const { host, rerender } = await render(<Emoji item={party} play />);
    expect(emoji(host).getAttribute("src")).toBe(party.animatedSrc);
    await rerender(<Emoji item={party} play={false} />);
    await userEvent.hover(emoji(host));
    expect(emoji(host).getAttribute("src")).toBe(party.src);
    await rerender(<Emoji item={party} />);
    await act(async () => void emoji(host).dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" })));
    expect(emoji(host).getAttribute("src")).toBe(party.animatedSrc);
    // The pointer leaves while play is set, unseen: without play again, the emoji is still.
    await rerender(<Emoji item={party} play={false} />);
    await act(async () => void emoji(host).dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" })));
    await rerender(<Emoji item={party} />);
    expect(emoji(host).getAttribute("src")).toBe(party.src);
    await rerender(<Emoji item={wave} skinTone="light" play />);
    expect(emoji(host).getAttribute("src")).toBe(image("wave tone1 moving"));
    await rerender(<Emoji item={heart} play />);
    expect(emoji(host).getAttribute("src")).toBe(heart.src);
  });

  it("follows OuroProvider's motion over the device: reduced shows the still image, full plays", async () => {
    // The device asks for reduced motion here (the file's setting).
    const { host } = await render(
      <>
        <OuroProvider motion="full">
          <Emoji item={party} play />
        </OuroProvider>
        <OuroProvider motion="system">
          <Emoji item={party} play />
        </OuroProvider>
      </>,
    );
    const [full, system] = images(host);
    expect(full!.getAttribute("src")).toBe(party.animatedSrc);
    expect(system!.getAttribute("src")).toBe(party.src);
    await motion();
    const still = await render(
      <OuroProvider motion="reduced">
        <Emoji item={party} play />
      </OuroProvider>,
    );
    expect(emoji(still.host).getAttribute("src")).toBe(party.src);
  });

  it("shows the still image with reduced motion, whatever play says or the pointer does", async () => {
    const { host } = await render(
      <>
        <Emoji item={party} play />
        <button type="button">
          <Emoji item={wave} />
        </button>
        <Emoji item={blink} play />
      </>,
    );
    const [played, inButton, filmstrip] = images(host);
    expect(filmstrip!.getAttribute("src")).toBe(blink.src);
    expect(filmstrip!.getAnimations()).toEqual([]);
    expect(played!.getAttribute("src")).toBe(party.src);
    expect(played!.getAttribute("srcset")).toBe(party.srcSet);
    await userEvent.hover(host.querySelector("button")!);
    await act(async () => host.querySelector("button")!.focus());
    expect(inButton!.getAttribute("src")).toBe(wave.src);
  });

  it("renders the still image on the server and hydrates to it without a mismatch", async () => {
    await motion();
    const node = <Emoji item={party} play />;
    const html = renderToString(node);
    expect(html).toContain(`src="${party.src.replaceAll("&", "&amp;")}"`);
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    mounted.push(host);
    const recoverable = vi.fn();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      roots.push(hydrateRoot(host, node, { onRecoverableError: recoverable }));
    });
    expect(recoverable).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(emoji(host).getAttribute("src")).toBe(party.animatedSrc);
  });

  it("passes the img attributes and ref through, and lets app layout classes win", async () => {
    const ref = { current: null as HTMLImageElement | null };
    const { host } = await render(<Emoji item={fern} ref={ref} title="Fernwood fern" className="size-8 ms-1" data-testid="fern" />);
    expect(ref.current).toBe(emoji(host));
    expect(emoji(host).title).toBe("Fernwood fern");
    expect(emoji(host).dataset.testid).toBe("fern");
    expect(emoji(host).getBoundingClientRect().width).toBe(32);
    expect(messages()).toEqual([]);
  });

  it("names a missing image, an unknown skin tone, an appearance class and other libraries' props, each with the fix", async () => {
    const props = { item: { id: "blank", name: "Blank" }, skinTone: "tan", className: "rounded-full", src: "/x.png", emoji: "🎉", animate: true } as unknown as EmojiProps;
    const { host } = await render(<Emoji {...props} />);
    expect(messages()).toEqual([
      '[ouro-ui] Emoji: "rounded-full" sets appearance, and className is for layout only. Fix: remove "rounded-full"; an emoji is its image.',
      '[ouro-ui] Emoji: item has no src, so there is no image to draw. Fix: <Emoji item={{ id: "party", name: "Party popper", src: "/emoji/party.png" }} />.',
      '[ouro-ui] Emoji: skinTone="tan" is not a skin tone; use "default", "light", "medium-light", "medium", "medium-dark", "dark". Fix: <Emoji item={item} skinTone="medium" />.',
      "[ouro-ui] Emoji: src is not a prop; the image comes from item. Fix: <Emoji item={{ id, name, src }} />.",
      "[ouro-ui] Emoji: emoji is not a prop; Emoji draws a catalogue's item. Fix: <Emoji item={catalogueItem} />.",
      "[ouro-ui] Emoji: animate is not a prop. Fix: <Emoji item={item} play />.",
    ]);
    expect(emoji(host).hasAttribute("src")).toBe(false);
    expect(emoji(host).hasAttribute("emoji")).toBe(false);
    expect(emoji(host).hasAttribute("animate")).toBe(false);
  });
});

describe("Emoji's animation", () => {
  /** Every address an image was given; nothing on the page shows an animation that is not playing, so one here was fetched ahead. */
  const fetched = (sources: { mock: { calls: unknown[][] } }) => sources.mock.calls.map(([src]) => src);

  it("is fetched once the still image has loaded, so the first play starts at once, the still showing until then", async () => {
    await motion();
    const sources = vi.spyOn(HTMLImageElement.prototype, "src", "set");
    const stills = [party.src, blink.src, heart.src, wave.src, tones[2]!.src];
    // What was fetched ahead: every address but the stills the page draws.
    const ahead = () => fetched(sources).filter((src) => !stills.includes(src as string));
    const drawn = (item: EmojiItem, skinTone?: EmojiSkinTone) => (
      <p>
        <Emoji item={party} /> <Emoji item={blink} /> <Emoji item={heart} /> <Emoji item={item} skinTone={skinTone} />
      </p>
    );
    const { host, rerender } = await render(drawn(wave));
    await expect.poll(() => ahead().sort()).toEqual([party.animatedSrc, blink.filmstrip!.src, wave.animatedSrc].sort());
    expect(images(host).map((picture) => picture.getAttribute("src"))).toEqual([party.src, blink.src, heart.src, wave.src]);
    // Another tone is another animation.
    await rerender(drawn(wave, "medium"));
    await expect.poll(ahead).toContain(tones[2]!.animatedSrc);
  });

  it("is fetched at low priority, and not for a still fetched at low priority or while the browser asks to save data", async () => {
    await motion();
    const priorities: string[] = [];
    const sources = vi.spyOn(HTMLImageElement.prototype, "src", "set").mockImplementation(function (this: HTMLImageElement, src: string) {
      if (src === party.animatedSrc) priorities.push(this.fetchPriority);
      this.setAttribute("src", src);
    });
    await render(<Emoji item={party} fetchPriority="high" />);
    await expect.poll(() => priorities).toEqual(["low"]);
    const low = await render(<Emoji item={wave} fetchPriority="low" />);
    await act(() => emoji(low.host).decode());
    Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData: true } });
    onTestFinished(() => void Reflect.deleteProperty(navigator, "connection"));
    const saving = await render(<Emoji item={blink} />);
    await act(() => emoji(saving.host).decode());
    expect(fetched(sources)).not.toContain(wave.animatedSrc);
    expect(fetched(sources)).not.toContain(blink.filmstrip!.src);
  });

  it("is fetched in a browser that does not say whether to save data, as Safari and Firefox do not", async () => {
    await motion();
    Object.defineProperty(navigator, "connection", { configurable: true, value: undefined });
    onTestFinished(() => void Reflect.deleteProperty(navigator, "connection"));
    const sources = vi.spyOn(HTMLImageElement.prototype, "src", "set");
    await render(<Emoji item={party} />);
    await expect.poll(() => fetched(sources)).toContain(party.animatedSrc);
  });

  it("is not fetched under reduced motion, which plays nothing, or for a still that fails to load", async () => {
    const sources = vi.spyOn(HTMLImageElement.prototype, "src", "set");
    const { host, rerender } = await render(<Emoji item={party} />);
    await act(() => emoji(host).decode());
    expect(fetched(sources)).not.toContain(party.animatedSrc);
    // Gone before motion is let through, which would let it play.
    await rerender(null);
    await motion();
    const broken = await render(<Emoji item={{ id: "broken", name: "Broken", src: "data:image/png;base64,AAAA", animatedSrc: image("broken moving") }} />);
    await act(() => emoji(broken.host).decode().catch(() => {}));
    expect(fetched(sources)).not.toContain(image("broken moving"));
  });
});

describe("Emoji placeholder", () => {
  const waitingSrc = image("waiting");
  /** The emoji's picture: the root's own `<img>`, named by the emoji. */
  const picture = (host: Element) => host.querySelector<HTMLImageElement>('[data-ouro="emoji"] > img')!;
  /** What stands in for the picture until it shows, hidden from screen readers. */
  const waiting = (host: Element) => host.querySelector<HTMLElement>('[data-ouro="emoji"] > [aria-hidden="true"]')!;
  const loaded = (host: Element) => emoji(host).hasAttribute("data-loaded");
  const opacity = (element: Element) => getComputedStyle(element).opacity;
  const visibility = (element: Element) => getComputedStyle(element).visibility;
  /** The element's box from the top left of the line it sits in. */
  const box = (element: Element, line: Element) => {
    const rect = element.getBoundingClientRect();
    const origin = line.getBoundingClientRect();
    return { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height };
  };

  const shortDuration = () => parseDuration(getComputedStyle(document.documentElement).getPropertyValue("--ouro-duration-fast"));
  /** The transitions running on the element, each as its property and duration. */
  const running = (element: Element) =>
    element
      .getAnimations()
      .map((animation) => `${(animation as CSSTransition).transitionProperty} ${animation.effect!.getTiming().duration}`)
      .sort();

  /** Holds every image's decode until the test settles it, listing each with the address the image had when it was asked. */
  function holdDecodes() {
    const held: { src: string; resolve: () => void; reject: (error: unknown) => void }[] = [];
    vi.spyOn(HTMLImageElement.prototype, "decode").mockImplementation(function (this: HTMLImageElement) {
      return new Promise<void>((resolve, reject) => held.push({ src: this.getAttribute("src")!, resolve, reject }));
    });
    return {
      held,
      /** Settles the decodes asked for `src`: decoded, or failed as a broken image fails. */
      settle: (src: string, ok = true) =>
        act(async () => {
          for (const call of held.filter((entry) => entry.src === src)) {
            if (ok) call.resolve();
            else call.reject(new DOMException("The source image cannot be decoded.", "EncodingError"));
          }
        }),
    };
  }

  it("shows a placeholder image in the emoji's own box until the picture has decoded, then the picture, named as before, with no shift", async () => {
    const { held, settle } = holdDecodes();
    const { host } = await render(
      <>
        <p style={{ fontSize: 20 }}>
          Hi <Emoji item={party} /> there
        </p>
        <p style={{ fontSize: 20 }}>
          Hi <Emoji item={party} placeholder={waitingSrc} /> there
        </p>
      </>,
    );
    const [bare, line] = [...host.querySelectorAll("p")].map((paragraph) => paragraph as HTMLElement) as [HTMLElement, HTMLElement];
    const expected = box(emoji(bare), bare);
    expect(expected.width).toBe(25);
    const root = emoji(line);
    expect(root.tagName).toBe("SPAN");
    expect(line.getBoundingClientRect().height).toBe(bare.getBoundingClientRect().height);
    expect(box(root, line)).toEqual(expected);
    expect(box(picture(line), line)).toEqual(expected);
    expect(box(waiting(line), line)).toEqual(expected);
    const stand = waiting(line).querySelector("img")!;
    expect(stand.getAttribute("src")).toBe(waitingSrc);
    expect(stand.alt).toBe("");
    expect(stand.draggable).toBe(false);
    expect(stand.getAttribute("decoding")).toBe("async");
    expect(picture(line).hasAttribute("data-ouro")).toBe(false);
    expect(box(stand, line)).toEqual(expected);
    expect(loaded(line)).toBe(false);
    expect(opacity(picture(line))).toBe("0");
    expect(visibility(waiting(line))).toBe("visible");
    expect(opacity(waiting(line))).toBe("1");
    // The picture keeps the emoji's name; the placeholder adds none.
    expect(page.elementLocator(line).getByRole("img").elements()).toEqual([picture(line)]);
    expect(picture(line).alt).toBe("Party popper");
    expect(picture(line).getAttribute("src")).toBe(party.src);
    expect(picture(line).getAttribute("srcset")).toBe(party.srcSet);
    // Only the emoji with a placeholder waits for its picture.
    expect(held.map((call) => call.src)).toEqual([party.src]);
    await settle(party.src);
    expect(root.getAttribute("data-loaded")).toBe("");
    expect(loaded(line)).toBe(true);
    expect(opacity(picture(line))).toBe("1");
    expect(visibility(waiting(line))).toBe("hidden");
    expect(box(root, line)).toEqual(expected);
    expect(box(picture(line), line)).toEqual(expected);
    expect(page.elementLocator(line).getByRole("img").elements()).toEqual([picture(line)]);
    expect(messages()).toEqual([]);
  });

  it("shows the picture once it has really loaded and decoded, and keeps the placeholder while a loaded picture is still decoding", async () => {
    const { host } = await render(<Emoji item={heart} placeholder={waitingSrc} />);
    await expect.poll(() => loaded(host)).toBe(true);
    expect(opacity(picture(host))).toBe("1");
    expect(visibility(waiting(host))).toBe("hidden");
    vi.spyOn(HTMLImageElement.prototype, "decode").mockReturnValue(new Promise(() => {}));
    const late = await render(<Emoji item={fern} placeholder={waitingSrc} />);
    await expect.poll(() => picture(late.host).complete).toBe(true);
    await act(async () => {});
    expect(loaded(late.host)).toBe(false);
    expect(opacity(picture(late.host))).toBe("0");
    expect(visibility(waiting(late.host))).toBe("visible");
  });

  it("keeps the placeholder for a picture that fails to load or to decode, and brings it back for a new picture that fails", async () => {
    const broken: EmojiItem = { ...heart, id: "broken", src: "data:image/png;base64,AAAA" };
    const { host, rerender } = await render(<Emoji item={broken} placeholder={waitingSrc} />);
    await picture(host)
      .decode()
      .catch(() => {});
    await act(async () => {});
    expect(loaded(host)).toBe(false);
    expect(opacity(picture(host))).toBe("0");
    expect(visibility(waiting(host))).toBe("visible");
    expect(picture(host).alt).toBe("Red heart");
    await rerender(<Emoji item={heart} placeholder={waitingSrc} />);
    await expect.poll(() => loaded(host)).toBe(true);
    await rerender(<Emoji item={broken} placeholder={waitingSrc} />);
    expect(loaded(host)).toBe(false);
    expect(opacity(picture(host))).toBe("0");
    expect(visibility(waiting(host))).toBe("visible");
    // A picture that loads but fails to decode keeps the placeholder too.
    const { settle } = holdDecodes();
    await rerender(<Emoji item={party} placeholder={waitingSrc} />);
    await settle(party.src, false);
    expect(loaded(host)).toBe(false);
    expect(opacity(picture(host))).toBe("0");
  });

  it("fades the picture in and the placeholder out over the short duration, and swaps them at once with reduced motion", async () => {
    await motion();
    const { settle } = holdDecodes();
    const fast = shortDuration();
    const { host, rerender } = await render(<Emoji item={party} placeholder={waitingSrc} />);
    expect(running(picture(host))).toEqual([]);
    expect(running(waiting(host))).toEqual([]);
    await settle(party.src);
    expect(running(picture(host))).toEqual([`opacity ${fast}`]);
    expect(running(waiting(host))).toEqual([`opacity ${fast}`, `visibility ${fast}`]);
    await expect.poll(() => picture(host).getAnimations().length + waiting(host).getAnimations().length).toBe(0);
    expect(opacity(picture(host))).toBe("1");
    expect(visibility(waiting(host))).toBe("hidden");
    // A new picture hides at once behind the placeholder, which shows at once.
    await rerender(<Emoji item={heart} placeholder={waitingSrc} />);
    expect(running(picture(host))).toEqual([]);
    expect(running(waiting(host))).toEqual([]);
    expect(opacity(picture(host))).toBe("0");
    expect(opacity(waiting(host))).toBe("1");
    // Reduced motion reaches the emoji with its next render.
    await commands.emulateMedia({ reducedMotion: "reduce" });
    await rerender(<Emoji item={heart} placeholder={waitingSrc} />);
    await settle(heart.src);
    expect(loaded(host)).toBe(true);
    expect(running(picture(host))).toEqual([]);
    expect(running(waiting(host))).toEqual([]);
    expect(opacity(picture(host))).toBe("1");
    expect(visibility(waiting(host))).toBe("hidden");
  });

  it("fades by OuroProvider's motion over the device's: over the short duration under full, and at once under reduced", async () => {
    const { settle } = holdDecodes();
    const fast = shortDuration();
    // The device asks for reduced motion here (the file's setting); full fades all the same.
    const full = await render(
      <OuroProvider motion="full">
        <Emoji item={party} placeholder={waitingSrc} />
      </OuroProvider>,
    );
    expect(running(picture(full.host))).toEqual([]);
    await settle(party.src);
    expect(running(picture(full.host))).toEqual([`opacity ${fast}`]);
    expect(running(waiting(full.host))).toEqual([`opacity ${fast}`, `visibility ${fast}`]);
    await expect.poll(() => picture(full.host).getAnimations().length + waiting(full.host).getAnimations().length).toBe(0);
    // An app's own still setting: the device allows motion, and the picture still shows at once.
    await motion();
    const still = await render(
      <OuroProvider motion="reduced">
        <Emoji item={heart} placeholder={waitingSrc} />
      </OuroProvider>,
    );
    expect(running(picture(still.host))).toEqual([]);
    await settle(heart.src);
    expect(loaded(still.host)).toBe(true);
    expect(running(picture(still.host))).toEqual([]);
    expect(running(waiting(still.host))).toEqual([]);
    expect(opacity(picture(still.host))).toBe("1");
    expect(visibility(waiting(still.host))).toBe("hidden");
  });

  it("shows the placeholder again for a new picture or tone, and never for a stale picture's decode", async () => {
    const { settle } = holdDecodes();
    const { host, rerender } = await render(<Emoji item={party} placeholder={waitingSrc} />);
    await rerender(<Emoji item={heart} placeholder={waitingSrc} />);
    expect(picture(host).getAttribute("src")).toBe(heart.src);
    await settle(heart.src);
    expect(loaded(host)).toBe(true);
    // The first picture's decode, ending late either way, changes nothing.
    await settle(party.src);
    expect(loaded(host)).toBe(true);
    await settle(party.src, false);
    expect(loaded(host)).toBe(true);
    await rerender(<Emoji item={wave} skinTone="medium" placeholder={waitingSrc} />);
    expect(picture(host).getAttribute("src")).toBe(tones[2]!.src);
    expect(loaded(host)).toBe(false);
    await settle(tones[2]!.src);
    expect(loaded(host)).toBe(true);
    await rerender(<Emoji item={{ ...wave, src: image("wave redrawn") }} placeholder={waitingSrc} />);
    expect(loaded(host)).toBe(false);
    await settle(image("wave redrawn"));
    expect(loaded(host)).toBe(true);
  });

  it("keeps the picture while the emoji plays and stops, and shows a picture only its animation could draw", async () => {
    await motion();
    const { settle } = holdDecodes();
    const { host, rerender } = await render(<Emoji item={party} play={false} placeholder={waitingSrc} />);
    await settle(party.src);
    await rerender(<Emoji item={party} play placeholder={waitingSrc} />);
    expect(picture(host).getAttribute("src")).toBe(party.animatedSrc);
    expect(loaded(host)).toBe(true);
    await rerender(<Emoji item={party} play={false} placeholder={waitingSrc} />);
    expect(picture(host).getAttribute("src")).toBe(party.src);
    // The animation's decode, cut short as the emoji stopped, changes nothing.
    await settle(party.animatedSrc!, false);
    expect(loaded(host)).toBe(true);
    // A still image that fails, with an animation that draws: the picture shows while it plays.
    const stuck: EmojiItem = { ...party, id: "stuck", src: image("stuck") };
    await rerender(<Emoji item={stuck} play={false} placeholder={waitingSrc} />);
    await settle(stuck.src, false);
    expect(loaded(host)).toBe(false);
    await rerender(<Emoji item={stuck} play placeholder={waitingSrc} />);
    expect(loaded(host)).toBe(false);
    await settle(stuck.animatedSrc!);
    expect(loaded(host)).toBe(true);
    await rerender(<Emoji item={stuck} play={false} placeholder={waitingSrc} />);
    await settle(stuck.src, false);
    expect(loaded(host)).toBe(false);
    // With reduced motion it never plays, so the still image decides.
    await commands.emulateMedia({ reducedMotion: "reduce" });
    await rerender(<Emoji item={stuck} play placeholder={waitingSrc} />);
    expect(picture(host).getAttribute("src")).toBe(stuck.src);
    expect(loaded(host)).toBe(false);
  });

  it("shows the picture without a React update, so a decode that ends outside act stays quiet where tests want act", async () => {
    const { held } = holdDecodes();
    const { host } = await render(<Emoji item={party} placeholder={waitingSrc} />);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // As in an app whose test setup turns React's act environment on for every test.
    const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    onTestFinished(() => {
      environment.IS_REACT_ACT_ENVIRONMENT = false;
    });
    for (const call of held) call.resolve();
    await expect.poll(() => loaded(host)).toBe(true);
    await new Promise(requestAnimationFrame);
    expect(opacity(picture(host))).toBe("1");
    expect(error).not.toHaveBeenCalled();
  });

  it("renders the placeholder on the server and hydrates to it without a mismatch, then shows the picture", async () => {
    const node = <Emoji item={party} placeholder={waitingSrc} />;
    const html = renderToString(node);
    expect(html).toContain(`src="${waitingSrc.replaceAll("&", "&amp;")}"`);
    const host = document.createElement("div");
    host.innerHTML = html;
    expect(loaded(host)).toBe(false);
    document.body.append(host);
    mounted.push(host);
    const recoverable = vi.fn();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      roots.push(hydrateRoot(host, node, { onRecoverableError: recoverable }));
    });
    expect(recoverable).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    await expect.poll(() => loaded(host)).toBe(true);
  });

  it("draws an element placeholder hidden from screen readers, and passes the img attributes, ref and layout classes through", async () => {
    holdDecodes();
    const ref = { current: null as HTMLImageElement | null };
    const { host, rerender } = await render(
      <Emoji item={fern} ref={ref} title="Fernwood fern" className="size-8 ms-1" data-testid="fern" placeholder={<svg data-testid="dot" viewBox="0 0 1 1" />} />,
    );
    expect(ref.current).toBe(picture(host));
    expect(picture(host).title).toBe("Fernwood fern");
    expect(picture(host).dataset.testid).toBe("fern");
    expect(emoji(host).getBoundingClientRect().width).toBe(32);
    expect(getComputedStyle(emoji(host)).marginInlineStart).toBe("4px");
    expect(picture(host).getBoundingClientRect().width).toBe(32);
    expect(picture(host).getBoundingClientRect().x).toBe(emoji(host).getBoundingClientRect().x);
    expect(waiting(host).getBoundingClientRect().width).toBe(32);
    expect(waiting(host).querySelector('[data-testid="dot"]')).not.toBeNull();
    expect(page.elementLocator(host).getByRole("img").elements()).toEqual([picture(host)]);
    expect(page.elementLocator(host).getByRole("img", { name: "Fernwood fern" }).elements()).toEqual([picture(host)]);
    // Without a placeholder it is the bare image again.
    await rerender(<Emoji item={fern} ref={ref} />);
    expect(emoji(host).tagName).toBe("IMG");
    expect(ref.current).toBe(emoji(host));
    expect(messages()).toEqual([]);
  });
});

describe("EmojiText", () => {
  const parts = (host: Element) =>
    [...host.querySelector('[data-ouro="emoji-text"]')!.childNodes].map((node) => (node instanceof HTMLImageElement ? `[${node.alt}|${node.getAttribute("src")}]` : node.textContent));
  const drawn = (item: { src: string }, name: string) => `[${name}|${item.src}]`;

  it("draws shortcode, id and tone id tokens as their images, and leaves unknown ones as text", async () => {
    const { host } = await render(<EmojiText text=":party: at 10:30:fern: :TADA: :Heart: :wave-tone3: :nope: tada :party:heart: :" catalogue={catalogue} />);
    expect(parts(host)).toEqual([
      drawn(party, "Party popper"),
      " at 10:30",
      drawn(fern, "Fernwood fern"),
      " ",
      drawn(party, "Party popper"),
      " ",
      drawn(heart, "Red heart"),
      " ",
      drawn(tones[2]!, "Waving hand"),
      " :nope: tada ",
      drawn(party, "Party popper"),
      "heart: :",
    ]);
  });

  it("draws the emoji text the catalogue lists as its images, longest first, with or without a variation selector", async () => {
    const { host } = await render(<EmojiText text={"👋🏽👋 hi ❤ and ❤️"} catalogue={catalogue} />);
    expect(parts(host)).toEqual([drawn(tones[2]!, "Waving hand"), drawn(wave, "Waving hand"), " hi ", drawn(heart, "Red heart"), " and ", drawn(heart, "Red heart")]);
  });

  it("enlarges up to three emoji alone, and nothing with other text, more emoji or without enlarge", async () => {
    const { host, rerender } = await render(
      <p style={{ fontSize: 16 }}>
        <EmojiText text=" :party: :heart: 🎉 " catalogue={catalogue} enlarge />
      </p>,
    );
    const root = () => host.querySelector('[data-ouro="emoji-text"]')!;
    const widths = () => images(host).map((img) => img.getBoundingClientRect().width);
    expect(root().getAttribute("data-enlarged")).toBe("");
    expect(widths()).toEqual([44, 44, 44]);
    await rerender(<EmojiText text=":party: :heart: :party: :heart:" catalogue={catalogue} enlarge />);
    expect(root().hasAttribute("data-enlarged")).toBe(false);
    await rerender(<EmojiText text="ok :party:" catalogue={catalogue} enlarge />);
    expect(root().hasAttribute("data-enlarged")).toBe(false);
    await rerender(<EmojiText text="   " catalogue={catalogue} enlarge />);
    expect(root().hasAttribute("data-enlarged")).toBe(false);
    await rerender(
      <p style={{ fontSize: 16 }}>
        <EmojiText text=":party:" catalogue={catalogue} />
      </p>,
    );
    expect(root().hasAttribute("data-enlarged")).toBe(false);
    expect(widths()).toEqual([20]);
  });

  it("keeps every line and every emoji where a loaded picture would, when its picture fails to load", async () => {
    // The same text twice, one with every picture there and one with every picture missing: the browser draws a
    // missing one's name in its place, which must not move the line it sits on, or the lines after it.
    const missing: EmojiCatalogue = {
      categories: [{ id: "symbols", label: "Symbols", items: [party, heart, fern].map((item, index) => ({ ...item, src: `/__ouro-missing-emoji-${index}.png`, srcSet: undefined })) }],
    };
    const text = "Shipped :party: the notes, :heart: thanks all :fern: see you";
    const paragraph = (set: EmojiCatalogue) => (
      <p style={{ width: 160, margin: 0, fontSize: 16, lineHeight: 1.5 }}>
        <EmojiText text={text} catalogue={set} />
      </p>
    );
    const { host } = await render(
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {paragraph(catalogue)}
        {paragraph(missing)}
      </div>,
    );
    const [loaded, failed] = [...host.querySelectorAll("p")];
    await expect.poll(() => images(host).every((img) => img.complete)).toBe(true);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(images(failed!).map((img) => img.naturalWidth)).toEqual([0, 0, 0]);
    const layout = (p: Element) => {
      const top = p.getBoundingClientRect().top;
      return { height: p.getBoundingClientRect().height, emoji: images(p).map((img) => Math.round(img.getBoundingClientRect().top - top)) };
    };
    expect(layout(failed!)).toEqual(layout(loaded!));
  });

  it("counts an emoji in two categories once, and keeps the span's attributes and layout classes", async () => {
    const { host } = await render(<EmojiText text="plain" catalogue={catalogue} id="body" className="mt-1" />);
    const root = host.querySelector<HTMLElement>('[data-ouro="emoji-text"]')!;
    expect(root.id).toBe("body");
    expect(root.className).toBe("mt-1");
    expect(root.textContent).toBe("plain");
    expect(messages()).toEqual([]);
  });

  it("names a missing catalogue, children and an appearance class with the fix, and shows the text as it is", async () => {
    const props = { text: "hi :party:", children: "hi", className: "text-red-500" } as unknown as EmojiTextProps;
    const { host } = await render(<EmojiText {...props} />);
    expect(messages()).toEqual([
      '[ouro-ui] EmojiText: "text-red-500" sets appearance, and className is for layout only. Fix: remove "text-red-500"; EmojiText takes the look of the text around it.',
      "[ouro-ui] EmojiText: catalogue is missing, so no emoji can be drawn. Fix: <EmojiText text={message.body} catalogue={catalogue} />.",
      "[ouro-ui] EmojiText: children is not a prop; the text goes in text. Fix: <EmojiText text={message.body} catalogue={catalogue} />.",
    ]);
    expect(host.textContent).toBe("hi :party:");
  });

  it("draws nothing for text given as children, with the fix", async () => {
    const props = { catalogue, children: "Shipped :party:" } as unknown as EmojiTextProps;
    const { host } = await render(<EmojiText {...props} />);
    expect(messages()).toEqual(["[ouro-ui] EmojiText: children is not a prop; the text goes in text. Fix: <EmojiText text={message.body} catalogue={catalogue} />."]);
    expect(host.querySelector('[data-ouro="emoji-text"]')!.textContent).toBe("");
  });
});

describe("Emoji helpers", () => {
  const keycap: EmojiItem = { id: "keycap-star", name: "Keycap asterisk", text: "*️⃣", src: image("keycap") };
  const withKeycap: EmojiCatalogue = { categories: [...catalogue.categories, { id: "keys", label: "Keys", items: [keycap] }] };

  it("indexes a catalogue once, each emoji once, by id, tone id, token and text", () => {
    const index = catalogueIndex(catalogue);
    expect(catalogueIndex(catalogue)).toBe(index);
    expect(index.items.map((item) => item.id)).toEqual(["wave", "heart", "party", "tada", "fern"]);
    expect(index.byId.get("wave-tone5")).toEqual({ item: wave, tone: "dark" });
    expect(index.byToken.get("tada")).toEqual({ item: party, tone: "default" });
    expect(index.byToken.get("fern")).toEqual({ item: fern, tone: "default" });
    expect(index.byText.get("❤")).toEqual({ item: heart, tone: "default" });
    expect(index.byText.has("")).toBe(false);
  });

  it("splits text into its runs and emoji with no empty runs between or around them", () => {
    expect(splitEmojiText(":party::heart:", catalogue)).toEqual([
      { item: party, tone: "default", source: ":party:" },
      { item: heart, tone: "default", source: ":heart:" },
    ]);
    // Emoji text alone, with tokens left as text, and nothing for a catalogue that lists no text.
    expect(splitEmojiText(":party: 🎉 ❤", catalogue, false)).toEqual([":party: ", { item: party, tone: "default", source: "🎉" }, " ", { item: heart, tone: "default", source: "❤" }]);
    expect(splitEmojiText("🎉 :tada:", { categories: [{ id: "plain", label: "Plain", items: [tada] }] }, false)).toEqual(["🎉 :tada:"]);
    expect(splitEmojiText("", catalogue)).toEqual([]);
  });

  it("passes text with no colon and no emoji text's first character straight through, and still finds a plain-text emoji", () => {
    expect(splitEmojiText("just words, no emoji here", catalogue)).toEqual(["just words, no emoji here"]);
    // A colon still lets a token through, and with tokens off it's plain text again.
    expect(splitEmojiText("time: 10:30", catalogue)).toEqual(["time: 10:30"]);
    expect(splitEmojiText("see :party:", catalogue, false)).toEqual(["see :party:"]);
    // An emoji whose text is ordinary characters is still found: its first character opens the search.
    const yes: EmojiItem = { id: "yes", name: "Yes", text: "(y)", src: image("yes") };
    expect(splitEmojiText("ok (y)", { categories: [{ id: "plain", label: "Plain", items: [yes] }] })).toEqual(["ok ", { item: yes, tone: "default", source: "(y)" }]);
  });

  it("runs its patterns only on text that could hold an emoji", () => {
    const matchAll = vi.spyOn(String.prototype, "matchAll");
    onTestFinished(() => matchAll.mockRestore());
    splitEmojiText("just words", catalogue);
    splitEmojiText("see :party:", catalogue, false);
    expect(matchAll).not.toHaveBeenCalled();
    splitEmojiText("see :party:", catalogue);
    expect(matchAll).toHaveBeenCalledTimes(1);
    const yes: EmojiItem = { id: "yes", name: "Yes", text: "(y)", src: image("yes") };
    splitEmojiText("ok (y)", { categories: [{ id: "plain", label: "Plain", items: [yes] }] }, false);
    expect(matchAll).toHaveBeenCalledTimes(2);
  });

  it("finds emoji text with characters a pattern would read as its own", () => {
    expect(splitEmojiText("press *️⃣ or *", withKeycap)).toEqual(["press ", { item: keycap, tone: "default", source: "*️⃣" }, " or *"]);
  });

  it("makes an emoji's token from its first shortcode, else its id, and a tone's id", () => {
    expect(emojiToken(party, "default")).toBe(":party:");
    expect(emojiToken(heart, "default")).toBe(":heart:");
    expect(emojiToken(wave, "medium-dark")).toBe(":wave-tone4:");
    expect(emojiToken(party, "dark")).toBe(":party:");
    expect(emojiToken(fern)).toBe(":Fern:");
  });

  it("turns each emoji the catalogue lists as text into its token, a whole character at a time", () => {
    const coder: EmojiItem = { id: "technologist", name: "Technologist", text: "👩‍💻", src: image("coder") };
    const thumbs: EmojiItem = { id: "thumbs", name: "Thumbs up", shortcodes: ["thumbsup"], text: "👍", src: image("thumbs") };
    const more: EmojiCatalogue = { categories: [...catalogue.categories, { id: "more", label: "More", items: [coder, thumbs] }] };
    expect(emojiTextToTokens("Hi 👋🎉!", more)).toBe("Hi :wave::party:!");
    // A skin tone modifier makes the toned emoji, a joined sequence its own emoji, and a variation selector changes nothing.
    expect(emojiTextToTokens("👋🏽 👩‍💻 ❤️ ❤", more)).toBe(":wave-tone3: :technologist: :heart: :heart:");
    // Only a whole character the catalogue lists changes: a toned form it lacks, a sequence it lacks and other emoji stay.
    expect(emojiTextToTokens("👍🏽 👍 👩‍🔬 🦄", more)).toBe("👍🏽 :thumbsup: 👩‍🔬 🦄");
    expect(emojiTextToTokens("Done :party: at 9:30", more)).toBe("Done :party: at 9:30");
    expect(emojiTextToTokens("🎉", { categories: [{ id: "custom", label: "Fernwood", items: [fern] }] })).toBe("🎉");
  });

  it("matches every typed word to the start of a word, a part of one, or a whole one, ignoring case, accents and colons", () => {
    const words = ["Party popper", "party_popper", "café-au-lait", "a:b"];
    expect(matchWords(words, "pop")).toBe(true);
    expect(matchWords(words, "PARTY POP")).toBe(true);
    expect(matchWords(words, "party_po")).toBe(true);
    expect(matchWords(words, ":party_popper:")).toBe(true);
    expect(matchWords(words, "cafe lait")).toBe(true);
    expect(matchWords(words, "b")).toBe(true);
    expect(matchWords(["Crème brûlée"], "creme brulee")).toBe(true);
    expect(matchWords(words, "::party")).toBe(true);
    expect(matchWords(words, "party::")).toBe(true);
    expect(matchWords(words, "a:b")).toBe(true);
    expect(matchWords(["a:b"], "a:x")).toBe(false);
    expect(matchWords(words, "arty")).toBe(false);
    expect(matchWords(words, "party cake")).toBe(false);
  });

  it("searches a catalogue by shortcode first, then name and keywords, up to the limit", () => {
    const searchable: EmojiCatalogue = {
      categories: [
        {
          id: "all",
          label: "All",
          items: [
            { id: "taco", name: "Taco", keywords: ["tasty"], src: image("taco") },
            { id: "tea", name: "Cup of tea", shortcodes: ["tea"], src: image("tea") },
            { id: "tada", name: "Party popper", shortcodes: ["tada"], src: image("tada") },
            { id: "cat", name: "Cat face", src: image("cat") },
            { id: "hotdog", name: "Hot dog", src: image("hotdog") },
            { id: "cheer", name: "Cheering", shortcodes: ["cheer", "hooray"], src: image("cheer") },
          ],
        },
      ],
    };
    const ids = (query: string, limit = 8) => searchCatalogue(searchable, query, limit).map((item) => item.id);
    expect(ids("ta")).toEqual(["tada", "taco"]);
    expect(ids("t")).toEqual(["tea", "tada", "taco"]);
    expect(ids("t", 2)).toEqual(["tea", "tada"]);
    expect(ids("CUP")).toEqual(["tea"]);
    expect(ids("tasty")).toEqual(["taco"]);
    // A second shortcode counts as a shortcode, ahead of a name.
    expect(ids("ho")).toEqual(["cheer", "hotdog"]);
    expect(ids("here")).toEqual([]);
  });
});
