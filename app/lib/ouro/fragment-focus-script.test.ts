import { afterEach, describe, expect, it } from "vitest";
import { fragmentFocusScript } from "~/lib/ouro/fragment-focus-script";

// fragmentFocusScript's own logic, in this page; site/e2e/fragment-focus.spec.ts loads pages with it in WebKit and
// Chromium, where Safari's jumps and the parser's wait can be seen. The script acts only where the browser says it is
// Safari, so here it runs under Safari's user agent in every engine, and a frame with Chrome's or Edge's checks the rest.

const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const EDGE = `${CHROME} Edg/141.0.0.0`;

/** Runs the script in `view`, which says it is the browser `userAgent` names. */
function runAs(view: Window & typeof globalThis, userAgent: string): void {
  Object.defineProperty(view.navigator, "userAgent", { configurable: true, get: () => userAgent });
  new view.Function(fragmentFocusScript())();
  delete (view.navigator as { userAgent?: string }).userAgent;
}

const address = location.pathname + location.search;
runAs(window, SAFARI);
// A second copy on the page installs nothing more.
runAs(window, SAFARI);

const made: Element[] = [];

afterEach(() => {
  for (const element of made.splice(0)) element.remove();
  history.replaceState(null, "", address);
});

function link(href: string, attributes: Record<string, string> = {}): HTMLAnchorElement {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.textContent = "Go";
  for (const [name, value] of Object.entries(attributes)) anchor.setAttribute(name, value);
  document.body.append(anchor);
  made.push(anchor);
  return anchor;
}

/** A stylesheet that starts loading now, and the promise of its load. */
function stylesheet(attributes: Record<string, string> = { href: "data:text/css,i{color:red}" }): { sheet: HTMLLinkElement; loaded: Promise<void> } {
  const sheet = document.createElement("link");
  sheet.rel = "stylesheet";
  for (const [name, value] of Object.entries(attributes)) sheet.setAttribute(name, value);
  const loaded = new Promise<void>((done) => sheet.addEventListener("load", () => done(), { once: true }));
  document.head.append(sheet);
  made.push(sheet);
  return { sheet, loaded };
}

/** Clicks `anchor` and says whether the script held the click back; the page itself goes nowhere. */
function heldBack(anchor: Element, init: MouseEventInit = {}): boolean {
  let held = false;
  window.addEventListener(
    "click",
    (event) => {
      held = event.defaultPrevented;
      event.preventDefault();
    },
    { once: true },
  );
  anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, ...init }));
  return held;
}

const task = () => new Promise((done) => setTimeout(done, 0));
/** A task after a stylesheet's load, when the script follows a link it held. */
const afterLoad = (loaded: Promise<void>) => loaded.then(task);
/** The end of parsing, as the page sees it. */
const parsed = () => document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));

describe("fragmentFocusScript", () => {
  it("does nothing in Chrome or Edge, which don't jump back", () => {
    for (const userAgent of [CHROME, EDGE]) {
      const frame = document.createElement("iframe");
      document.body.append(frame);
      made.push(frame);
      const view = frame.contentWindow as Window & typeof globalThis;
      runAs(view, userAgent);
      const sheet = Object.assign(view.document.createElement("link"), { rel: "stylesheet", href: URL.createObjectURL(new Blob(["i{}"], { type: "text/css" })) });
      const anchor = Object.assign(view.document.createElement("a"), { href: "#ff-chrome" });
      view.document.head.append(sheet);
      view.document.body.append(anchor);
      // After the script's own listener, as heldBack reads it; the frame goes nowhere.
      let held = true;
      view.addEventListener(
        "click",
        (event) => {
          held = event.defaultPrevented;
          event.preventDefault();
        },
        { once: true },
      );
      anchor.dispatchEvent(new view.MouseEvent("click", { bubbles: true, cancelable: true }));
      expect(held).toBe(false);
      view.document.dispatchEvent(new view.Event("DOMContentLoaded", { bubbles: true }));
      expect(sheet.disabled).toBe(false);
    }
  });

  it("says whether the parser ran it, and which element it is, for Ouro check: not a copy a script adds, or one run by hand", async () => {
    /** A page with the script in it, as `html` places it; resolves with what the script recorded and its element. */
    const page = async (html: string) => {
      const frame = document.createElement("iframe");
      frame.srcdoc = html.replace("SCRIPT", fragmentFocusScript().replaceAll("</", "<\\/"));
      const loaded = new Promise((done) => frame.addEventListener("load", done, { once: true }));
      document.body.append(frame);
      made.push(frame);
      await loaded;
      const view = frame.contentWindow as Window & typeof globalThis;
      const record = (view as unknown as { __ouroFragmentFocus: { parsed: boolean; script: Element | null } }).__ouroFragmentFocus;
      return { parsed: record.parsed, isFirst: record.script === view.document.querySelector("script"), inHead: record.script?.parentNode === view.document.head };
    };
    expect(await page("<!doctype html><head><title>t</title></head><body><script>SCRIPT</script><p>Page</p></body>")).toEqual({ parsed: true, isFirst: true, inHead: false });
    expect(
      await page('<!doctype html><head><title>t</title></head><body><p>Page</p><script type="text/plain" id="copy">SCRIPT</script><script>const copy = document.createElement("script"); copy.text = document.getElementById("copy").text; document.head.append(copy);</script><p>More</p></body>'),
    ).toMatchObject({ parsed: false, inHead: true });
    const frame = document.createElement("iframe");
    document.body.append(frame);
    made.push(frame);
    const view = frame.contentWindow as Window & typeof globalThis;
    runAs(view, SAFARI);
    expect((view as unknown as { __ouroFragmentFocus: unknown }).__ouroFragmentFocus).toEqual({ parsed: false, script: null });
  });

  it("leaves a link to a place on the page to the browser while no stylesheet is loading", () => {
    expect(heldBack(link("#ff-now"))).toBe(false);
  });

  it("holds a link to a place on the page while a stylesheet loads, and follows it once that has loaded", async () => {
    const { loaded } = stylesheet();
    expect(heldBack(link("#ff-later"))).toBe(true);
    expect(location.hash).toBe("");
    await afterLoad(loaded);
    expect(location.hash).toBe("#ff-later");
  });

  it("holds a link to the top of the page, whose address ends in a bare #", async () => {
    const { loaded } = stylesheet();
    expect(heldBack(link("#"))).toBe(true);
    await afterLoad(loaded);
    expect(location.href.endsWith("#")).toBe(true);
  });

  it("holds a link inside a shadow root too", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    made.push(host);
    const anchor = document.createElement("a");
    anchor.href = "#ff-shadow";
    host.attachShadow({ mode: "open" }).append(anchor);
    const { loaded } = stylesheet();
    expect(heldBack(anchor)).toBe(true);
    await afterLoad(loaded);
    expect(location.hash).toBe("#ff-shadow");
  });

  it("drops a held link once the page moves on, or another link is clicked", async () => {
    let { loaded } = stylesheet();
    expect(heldBack(link("#ff-left"))).toBe(true);
    history.pushState(null, "", "?ff-moved");
    await afterLoad(loaded);
    expect(location.search).toBe("?ff-moved");
    expect(location.hash).toBe("");
    history.replaceState(null, "", address);
    ({ loaded } = stylesheet());
    expect(heldBack(link("#ff-replaced"))).toBe(true);
    const routed = link("/ff-route");
    routed.addEventListener("click", (event) => event.preventDefault());
    heldBack(routed);
    await afterLoad(loaded);
    expect(location.hash).toBe("");
  });

  it("drops a held link at a hash change or a step back", async () => {
    for (const event of ["hashchange", "popstate"]) {
      const { loaded } = stylesheet();
      expect(heldBack(link("#ff-dropped"))).toBe(true);
      window.dispatchEvent(new Event(event));
      await afterLoad(loaded);
      expect(location.hash).toBe("");
    }
  });

  it("leaves alone, while a stylesheet loads, a click the page took, a modified or middle click, a link to another page, a new tab or a download", async () => {
    const { loaded } = stylesheet();
    const taken = link("#ff-taken");
    taken.addEventListener("click", (event) => event.preventDefault());
    heldBack(taken);
    expect(heldBack(link("#ff-modified"), { metaKey: true })).toBe(false);
    expect(heldBack(link("#ff-control"), { ctrlKey: true })).toBe(false);
    expect(heldBack(link("#ff-shift"), { shiftKey: true })).toBe(false);
    expect(heldBack(link("#ff-alt"), { altKey: true })).toBe(false);
    expect(heldBack(link("#ff-middle"), { button: 1 })).toBe(false);
    expect(heldBack(link("/elsewhere#ff-away"))).toBe(false);
    expect(heldBack(link("#ff-tab", { target: "_blank" }))).toBe(false);
    expect(heldBack(link("#ff-file", { download: "" }))).toBe(false);
    await afterLoad(loaded);
    expect(location.hash).toBe("");
  });

  it("holds a link that targets this page by name, or an area of an image map", async () => {
    const { loaded } = stylesheet();
    expect(heldBack(link("#ff-self", { target: "_self" }))).toBe(true);
    const area = document.createElement("area");
    area.href = "#ff-area";
    document.body.append(area);
    made.push(area);
    expect(heldBack(area)).toBe(true);
    await afterLoad(loaded);
  });

  it("counts no stylesheet as loading that has no address, is disabled, is an alternate, has loaded or has failed", async () => {
    void stylesheet({});
    void stylesheet({ href: "data:text/css,i{}", disabled: "" });
    void stylesheet({ href: "data:text/css,i{}", rel: "alternate stylesheet" });
    await stylesheet().loaded;
    const failed = stylesheet({ href: "data:text/css,i{}" }).sheet;
    failed.dispatchEvent(new Event("error"));
    expect(heldBack(link("#ff-quiet"))).toBe(false);
  });

  it("sets aside a stylesheet still loading as parsing ends, puts it back a moment later, and leaves a loaded one alone", async () => {
    const { sheet: done, loaded: doneLoaded } = stylesheet();
    await doneLoaded;
    // From a blob, so it loads in a later task in every engine (a data: stylesheet has its sheet at once in Chromium).
    const { sheet, loaded } = stylesheet({ href: URL.createObjectURL(new Blob(["html{--ff-aside:1}"], { type: "text/css" })) });
    parsed();
    expect(sheet.disabled).toBe(true);
    expect(done.disabled).toBe(false);
    await task();
    expect(sheet.disabled).toBe(false);
    // Its own load still comes, for whatever waits on it; that it then applies is Safari's part (site/e2e/fragment-focus.spec.ts).
    await loaded;
  });
});
