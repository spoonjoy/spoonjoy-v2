import { afterEach, describe, expect, it, vi } from "vitest";
import { capsuleHalf, installSquircleCapsules, ROUND } from "~/lib/ouro/squircle-capsules";

describe("capsule measure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("exports ROUND, the round things an app's own squircles leave alone", () => {
    const round = document.createElement("span");
    round.setAttribute("data-ouro-avatar-presence", "");
    const plain = document.createElement("span");
    expect(round.matches(ROUND)).toBe(true);
    expect(plain.matches(ROUND)).toBe(false);
  });

  it("takes half the shorter side in eighths of a pixel", () => {
    expect(capsuleHalf(100, 31.8)).toBe(15.875);
    expect(capsuleHalf(20, 40)).toBe(10);
  });

  it("does nothing where corner-shape is drawn", () => {
    // Fully supported either way: an OR bails here on corner-shape alone; a mistaken AND would not.
    const supports = vi.spyOn(CSS, "supports").mockReturnValue(true);
    const mutationObserve = vi.spyOn(MutationObserver.prototype, "observe");
    const stop = installSquircleCapsules(document);
    expect(supports).toHaveBeenCalledWith("corner-shape", "squircle");
    expect(mutationObserve).not.toHaveBeenCalled();
    stop();
  });

  it("does nothing where a clip path shape is missing", () => {
    const supports = vi.spyOn(CSS, "supports").mockReturnValue(false);
    const mutationObserve = vi.spyOn(MutationObserver.prototype, "observe");
    const stop = installSquircleCapsules(document);
    expect(supports).toHaveBeenCalledWith("corner-shape", "squircle");
    expect(supports).toHaveBeenCalledWith("clip-path", "shape(from 0 0, close)");
    expect(mutationObserve).not.toHaveBeenCalled();
    expect(stop()).toBeUndefined();
  });

  it("leaves no capsule selector to find, and does not try an empty one", () => {
    // An iframe's fresh document has no stylesheets of its own, unlike the shared test document, which already
    // carries the app's own squircle-corner rules; querySelectorAll("") throws, so the guard must stop watch() first.
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const frameDoc = iframe.contentDocument!;
    expect(frameDoc.styleSheets.length).toBe(0);
    vi.spyOn(frameDoc.defaultView!.CSS, "supports").mockImplementation((prop: string) => prop === "clip-path");
    const querySelectorAll = vi.spyOn(frameDoc, "querySelectorAll");
    const stop = installSquircleCapsules(frameDoc);
    expect(querySelectorAll).not.toHaveBeenCalled();
    stop();
    iframe.remove();
  });

  it("writes a capsule's variables once per distinct half, not once per resize notification", () => {
    vi.spyOn(CSS, "supports").mockImplementation((prop: string) => prop === "clip-path");
    let capturedCallback: ResizeObserverCallback | undefined;
    class StubResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        capturedCallback = cb;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    const el = document.createElement("div");
    const setProperty = vi.spyOn(el.style, "setProperty");
    const entry = (inline: number, block: number) =>
      ({ target: el, borderBoxSize: [{ inlineSize: inline, blockSize: block }] }) as unknown as ResizeObserverEntry;
    const stop = installSquircleCapsules(document);
    capturedCallback!([entry(100, 20)], {} as ResizeObserver);
    expect(setProperty).toHaveBeenCalledTimes(2);
    // Same half (min side unchanged at 20) from a different box: the dedup guard skips the repeat write.
    capturedCallback!([entry(150, 20)], {} as ResizeObserver);
    expect(setProperty).toHaveBeenCalledTimes(2);
    // A genuinely different half writes again.
    capturedCallback!([entry(150, 40)], {} as ResizeObserver);
    expect(setProperty).toHaveBeenCalledTimes(4);
    stop();
  });

  it("observes each matching element's border box exactly once, even watched again", async () => {
    vi.spyOn(CSS, "supports").mockImplementation((prop: string) => prop === "clip-path");
    const observe = vi.spyOn(ResizeObserver.prototype, "observe");
    const style = document.createElement("style");
    style.textContent = ".once { --sq-tl: var(--sq-half); width: 40px; height: 20px; display: block }";
    document.head.append(style);
    const el = document.createElement("div");
    el.className = "once";
    document.body.append(el);
    const stop = installSquircleCapsules(document);
    expect(observe).toHaveBeenCalledExactlyOnceWith(el, { box: "border-box" });
    // A sheet added later re-runs the watch over every match; an element already watched is not observed twice.
    const other = document.createElement("style");
    other.textContent = ".once-other { --sq-tl: var(--sq-half) }";
    const scanned = vi.spyOn(Document.prototype, "querySelectorAll");
    document.head.append(other);
    await expect.poll(() => scanned.mock.calls.length).toBeGreaterThan(0);
    expect(observe).toHaveBeenCalledOnce();
    stop();
    style.remove();
    other.remove();
    el.remove();
  });

  it("stops both observers and forgets every watched element", async () => {
    vi.spyOn(CSS, "supports").mockImplementation((prop: string) => prop === "clip-path");
    const resizeDisconnect = vi.spyOn(ResizeObserver.prototype, "disconnect");
    const mutationObserve = vi.spyOn(MutationObserver.prototype, "observe");
    const mutationDisconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    const stop = installSquircleCapsules(document);
    expect(mutationObserve).toHaveBeenCalledExactlyOnceWith(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    const observe = vi.spyOn(ResizeObserver.prototype, "observe");
    const style = document.createElement("style");
    style.textContent = ".after-stop { --sq-tl: var(--sq-half); width: 40px; height: 20px; display: block }";
    document.head.append(style);
    // Before stop(), a mutation still runs watch(), proving this check means something.
    const before = document.createElement("div");
    before.className = "after-stop";
    document.body.append(before);
    await expect.poll(() => observe.mock.calls.length).toBe(1);
    stop();
    expect(resizeDisconnect).toHaveBeenCalledOnce();
    expect(mutationDisconnect).toHaveBeenCalledOnce();
    const after = document.createElement("div");
    after.className = "after-stop";
    document.body.append(after);
    await Promise.resolve();
    await Promise.resolve();
    // A mutation after stop() finds no watcher left to run watch() again.
    expect(observe).toHaveBeenCalledOnce();
    // Nor does a linked sheet that loads after stop().
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = URL.createObjectURL(new Blob([".after-stop { --sq-tl: var(--sq-half) }"], { type: "text/css" }));
    const loaded = new Promise((resolve) => link.addEventListener("load", resolve));
    document.head.append(link);
    await loaded;
    expect(observe).toHaveBeenCalledOnce();
    link.remove();
    style.remove();
    before.remove();
    after.remove();
  });

  it("measures a capsule the plugin waits on, and leaves a round control alone", async () => {
    vi.spyOn(CSS, "supports").mockImplementation((prop: string) => prop === "clip-path");
    const style = document.createElement("style");
    // A keyframe step's rule carries --sq-half in its cssText but has no cssRules of its own, unlike a style or
    // grouping rule; it goes first so a mistaken recursion into it throws before .cap and .nested are reached,
    // losing both instead of leaving them already collected.
    style.textContent = "@keyframes probe { 0% { --sq-half: 9px } }";
    style.textContent += ".cap { --sq-tl: var(--sq-half); width: 100px; height: 30px; display: block }";
    style.textContent += "@media all { .nested { --sq-tr: var(--sq-half); width: 60px; height: 20px; display: block } } .plain { width: 50px; height: 20px; display: block } @page { margin: 0 }";
    document.head.append(style);
    const nested = document.createElement("div");
    nested.className = "nested";
    const plain = document.createElement("div");
    plain.className = "plain";
    document.body.append(nested, plain);
    const cap = document.createElement("div");
    cap.className = "cap";
    const round = document.createElement("div");
    round.className = "cap";
    round.setAttribute("data-ouro-avatar-presence", "");
    document.body.append(cap, round);
    const stop = installSquircleCapsules(document);
    await expect.poll(() => cap.style.getPropertyValue("--sq-half")).toBe("15px");
    expect(cap.style.getPropertyValue("--sq-capsule-radius")).toBe(`${15 * 0.543}px`);
    expect(round.style.getPropertyValue("--sq-half")).toBe("");
    await expect.poll(() => nested.style.getPropertyValue("--sq-half")).toBe("10px");
    expect(plain.style.getPropertyValue("--sq-half")).toBe("");
    const later = cap.cloneNode() as HTMLElement;
    document.body.append(later);
    await expect.poll(() => later.style.getPropertyValue("--sq-half")).toBe("15px");
    stop();
    style.remove();
    cap.remove();
    round.remove();
    later.remove();
    nested.remove();
    plain.remove();
  });

  it("measures a capsule whose class arrives later, or whose rule is nested, and writes a control's squircle radius", async () => {
    vi.spyOn(CSS, "supports").mockImplementation((prop: string) => prop === "clip-path");
    const style = document.createElement("style");
    style.textContent = ".host .bar.on { --sq-tl: var(--sq-half); width: 100px; height: 30px; display: block }";
    style.textContent += ".wrap { & .inner { --sq-tr: var(--sq-half); width: 60px; height: 20px; display: block } }";
    document.head.append(style);
    const host = document.createElement("div");
    host.className = "host";
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.setAttribute("data-ouro-squircle", "");
    host.append(bar);
    const wrap = document.createElement("div");
    wrap.className = "wrap";
    const inner = document.createElement("div");
    inner.className = "inner";
    wrap.append(inner);
    document.body.append(host, wrap);
    const stop = installSquircleCapsules(document);
    await expect.poll(() => inner.style.getPropertyValue("--sq-half")).toBe("10px");
    expect(wrap.style.getPropertyValue("--sq-half")).toBe("");
    expect(bar.style.getPropertyValue("--sq-half")).toBe("");
    // A class change that makes an element no capsule, in the same task, leaves it unread.
    host.classList.add("shown");
    bar.classList.add("on");
    await expect.poll(() => bar.style.getPropertyValue("--sq-half")).toBe("15px");
    expect(bar.style.getPropertyValue("--ouro-sq-r")).toBe("15px");
    expect(host.style.getPropertyValue("--sq-half")).toBe("");
    stop();
    style.remove();
    host.remove();
    wrap.remove();
  });

  it("reads a nested rule under a list of parents, a list inside :is() and any corner that waits on --sq-half as the selectors they make", async () => {
    vi.spyOn(CSS, "supports").mockImplementation((prop: string) => prop === "clip-path");
    const style = document.createElement("style");
    style.textContent = ".w1, .w2 { &:is(.ca, .cb) { --sq-br: var(--sq-half); width: 60px; height: 20px; display: block } }";
    style.textContent += ".cc { --sq-bl: var(--sq-half); width: 40px; height: 16px; display: block }";
    style.textContent += ".w1, .ca { width: 80px; height: 30px; display: block }";
    document.head.append(style);
    const make = (className: string) => {
      const el = document.createElement("div");
      el.className = className;
      return el;
    };
    const a = make("w1 ca");
    const b = make("w2 cb");
    const cc = make("cc");
    const parent = make("w1");
    const lone = make("ca");
    document.body.append(a, b, cc, parent, lone);
    const stop = installSquircleCapsules(document);
    await expect.poll(() => [a, b, cc].map((el) => el.style.getPropertyValue("--sq-half"))).toEqual(["10px", "10px", "8px"]);
    // Neither a parent alone nor a .ca without one.
    expect([parent, lone].map((el) => el.style.getPropertyValue("--sq-half"))).toEqual(["", ""]);
    stop();
    style.remove();
    for (const el of [a, b, cc, parent, lone]) el.remove();
  });

  describe("cost", () => {
    const force = () => vi.spyOn(CSS, "supports").mockImplementation((prop: string) => prop === "clip-path");
    const settle = async () => {
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    };

    it("rescans no stylesheet and no document across a burst of text edits", async () => {
      force();
      const style = document.createElement("style");
      style.textContent = ".typing-cap { --sq-tl: var(--sq-half); width: 100px; height: 30px; display: block }";
      document.head.append(style);
      const field = document.createElement("div");
      field.contentEditable = "true";
      document.body.append(field);
      const stop = installSquircleCapsules(document);
      const rules = vi.spyOn(CSSStyleSheet.prototype, "cssRules", "get");
      const all = vi.spyOn(Document.prototype, "querySelectorAll");
      const computed = vi.spyOn(window, "getComputedStyle");
      for (let i = 0; i < 20; i++) {
        field.append(document.createTextNode("k"));
        field.firstChild!.textContent += "j";
        await Promise.resolve();
        await Promise.resolve();
      }
      await settle();
      expect(rules).not.toHaveBeenCalled();
      expect(all).not.toHaveBeenCalled();
      expect(computed).not.toHaveBeenCalled();
      stop();
      style.remove();
      field.remove();
    });

    it("draws a node added later with a capsule class, nested ones too", async () => {
      force();
      const style = document.createElement("style");
      style.textContent = ".added-cap { --sq-tl: var(--sq-half); width: 100px; height: 30px; display: block }";
      document.head.append(style);
      const stop = installSquircleCapsules(document);
      const wrap = document.createElement("section");
      const el = document.createElement("div");
      el.className = "added-cap";
      const own = el.cloneNode() as HTMLElement;
      // A node added on its own that matches no capsule rule is left alone.
      const plain = document.createElement("div");
      plain.style.cssText = "width: 100px; height: 30px";
      wrap.append(el);
      document.body.append(wrap, own, plain);
      await expect.poll(() => el.style.getPropertyValue("--sq-half")).toBe("15px");
      await expect.poll(() => own.style.getPropertyValue("--sq-half")).toBe("15px");
      await settle();
      expect(plain.style.getPropertyValue("--sq-half")).toBe("");
      stop();
      style.remove();
      wrap.remove();
      own.remove();
      plain.remove();
    });

    it("draws an existing element once a stylesheet made it a capsule", async () => {
      force();
      const el = document.createElement("div");
      el.className = "late-cap";
      document.body.append(el);
      const stop = installSquircleCapsules(document);
      const style = document.createElement("style");
      style.textContent = ".late-cap { --sq-tl: var(--sq-half); width: 100px; height: 30px; display: block }";
      document.head.append(style);
      await expect.poll(() => el.style.getPropertyValue("--sq-half")).toBe("15px");
      stop();
      style.remove();
      el.remove();
    });

    it("reads a linked stylesheet once it has loaded", async () => {
      force();
      const el = document.createElement("div");
      el.className = "linked-cap";
      document.body.append(el);
      const stop = installSquircleCapsules(document);
      const css = ".linked-cap { --sq-tl: var(--sq-half); width: 100px; height: 30px; display: block }";
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = URL.createObjectURL(new Blob([css], { type: "text/css" }));
      document.head.append(link);
      await expect.poll(() => el.style.getPropertyValue("--sq-half")).toBe("15px");
      stop();
      link.remove();
      el.remove();
    });

    it("draws an element after its style element's text is replaced", async () => {
      force();
      const style = document.createElement("style");
      document.head.append(style);
      const el = document.createElement("div");
      el.className = "text-cap";
      document.body.append(el);
      const stop = installSquircleCapsules(document);
      style.textContent = ".text-cap { --sq-tl: var(--sq-half); width: 100px; height: 30px; display: block }";
      await expect.poll(() => el.style.getPropertyValue("--sq-half")).toBe("15px");
      stop();
      style.remove();
      el.remove();
    });
    it("rescans nothing for non-stylesheet link loads or a load that is no link's", async () => {
      force();
      const style = document.createElement("style");
      style.textContent = ".non-sheet-cap { --sq-tl: var(--sq-half) }";
      document.head.append(style);
      const stop = installSquircleCapsules(document);
      const rules = vi.spyOn(CSSStyleSheet.prototype, "cssRules", "get");
      const all = vi.spyOn(Document.prototype, "querySelectorAll");
      const href = URL.createObjectURL(new Blob([""], { type: "text/javascript" }));
      const links = ["icon", "modulepreload", "preload"].map((rel) => {
        const link = document.createElement("link");
        link.rel = rel;
        link.as = "script";
        link.href = href;
        return link;
      });
      const wrap = document.createElement("div");
      wrap.append(links[0]!.cloneNode());
      document.body.append(wrap);
      document.head.append(...links);
      for (const link of links) link.dispatchEvent(new Event("load"));
      wrap.dispatchEvent(new Event("load"));
      document.dispatchEvent(new Event("load"));
      await settle();
      expect(rules).not.toHaveBeenCalled();
      expect(all).not.toHaveBeenCalled();
      stop();
      URL.revokeObjectURL(href);
      style.remove();
      for (const link of links) link.remove();
      wrap.remove();
    });

    it("reads a preloaded sheet only after it becomes a stylesheet and draws its capsule", async () => {
      force();
      const el = document.createElement("div");
      el.className = "preloaded-cap";
      document.body.append(el);
      const stop = installSquircleCapsules(document);
      const rules = vi.spyOn(CSSStyleSheet.prototype, "cssRules", "get");
      const all = vi.spyOn(Document.prototype, "querySelectorAll");
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = "style";
      const css = ".preloaded-cap { --sq-tl: var(--sq-half); width: 100px; height: 30px; display: block }";
      link.href = URL.createObjectURL(new Blob([css], { type: "text/css" }));
      let preloaded = false;
      link.addEventListener("load", () => { preloaded = true; }, { once: true });
      document.head.append(link);
      await expect.poll(() => preloaded).toBe(true);
      expect(link.sheet).toBeNull();
      expect(rules).not.toHaveBeenCalled();
      expect(all).not.toHaveBeenCalled();
      expect(el.style.getPropertyValue("--sq-half")).toBe("");
      link.rel = "stylesheet";
      await expect.poll(() => el.style.getPropertyValue("--sq-half")).toBe("15px");
      expect(link.sheet).not.toBeNull();
      expect(rules).toHaveBeenCalled();
      expect(all).toHaveBeenCalled();
      stop();
      URL.revokeObjectURL(link.href);
      link.remove();
      el.remove();
    });

    it("reads a stylesheet that arrives inside an added subtree", async () => {
      force();
      const stop = installSquircleCapsules(document);
      const wrap = document.createElement("div");
      wrap.innerHTML = '<style>.nested-sheet-cap { --sq-tl: var(--sq-half); width: 100px; height: 30px; display: block }</style><p class="nested-sheet-cap"></p>';
      document.body.append(wrap);
      const el = wrap.querySelector("p")!;
      await expect.poll(() => el.style.getPropertyValue("--sq-half")).toBe("15px");
      stop();
      wrap.remove();
    });

    it("looks at an added node when no capsule selector exists", async () => {
      force();
      const iframe = document.createElement("iframe");
      document.body.append(iframe);
      const frameDoc = iframe.contentDocument!;
      vi.spyOn(frameDoc.defaultView!.CSS, "supports").mockImplementation((prop: string) => prop === "clip-path");
      const stop = installSquircleCapsules(frameDoc);
      frameDoc.body.append(frameDoc.createElement("div"));
      await settle();
      stop();
      iframe.remove();
    });
  });
});
