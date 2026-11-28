import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";
import { ScrollArea } from "@base-ui/react/scroll-area";
import { OuroProvider, type OuroLinkComponent } from "~/lib/ouro/ouro-provider";
import { installSquircleCapsules } from "~/lib/ouro/squircle-capsules";
import { useOuro } from "~/lib/ouro/use-ouro";
import { useReducedMotion } from "~/lib/ouro/use-reduced-motion";
import { act } from "~/lib/ouro/testing/act";

// Wraps the real installSquircleCapsules in a spy, so a test can tell whether OuroProvider's own gate ever
// reached the import at all. squircle-capsules.ts repeats the same corner-shape/clip-path check inside
// installSquircleCapsules itself, so watching only its effects (a MutationObserver) can't tell a provider
// that skipped the import apart from one that imported it and let the inner check bail.
// Mocks via a real import() expression (vi.mock's typed-path form), not a bare string: shadcn's install-time
// rewriter only rewrites import declarations and import() calls, so a string literal here would be left
// pointing at the pre-install registry path after install, no longer matching the path OuroProvider's own
// import() resolves to.
vi.mock(import("~/lib/ouro/squircle-capsules"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, installSquircleCapsules: vi.fn(actual.installSquircleCapsules) };
});

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
  vi.restoreAllMocks();
  await commands.emulateMedia({ reducedMotion: "no-preference" });
});

async function mount(node: ReactNode) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(node));
  return container;
}

function Link() {
  const { linkComponent: LinkComponent } = useOuro();
  return (
    <LinkComponent href="/recipes" className="mt-2">
      Recipes
    </LinkComponent>
  );
}

describe("OuroProvider and useOuro", () => {
  it("defaults to a plain anchor without a provider", async () => {
    const container = await mount(<Link />);
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("/recipes");
    expect(anchor?.className).toBe("mt-2");
    expect(anchor?.textContent).toBe("Recipes");
  });

  it("defaults to a plain anchor inside a provider with no linkComponent", async () => {
    const container = await mount(
      <OuroProvider>
        <Link />
      </OuroProvider>,
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/recipes");
  });

  it("supplies a custom linkComponent, including a ref", async () => {
    let received: HTMLAnchorElement | null = null;
    const RouterLink: OuroLinkComponent = ({ ref, ...props }) => (
      <a
        {...props}
        data-router
        ref={(node) => {
          received = node;
          if (typeof ref === "function") ref(node);
        }}
      />
    );
    const container = await mount(
      <OuroProvider linkComponent={RouterLink}>
        <Link />
      </OuroProvider>,
    );
    expect(container.querySelector("a[data-router]")).not.toBeNull();
    expect(received).toBe(container.querySelector("a"));
  });

  it("gives its portalContainer to what it wraps, keeps an outer one when it sets none, and drops it when it sets null", async () => {
    const popups = document.body.appendChild(document.createElement("div"));
    const seen: unknown[] = [];
    function Read() {
      seen.push(useOuro().portalContainer);
      return null;
    }
    await mount(
      <>
        <Read />
        <OuroProvider portalContainer={popups}>
          <Read />
          <OuroProvider>
            <Read />
            <OuroProvider portalContainer={null}>
              <Read />
            </OuroProvider>
          </OuroProvider>
        </OuroProvider>
      </>,
    );
    expect(seen).toEqual([undefined, popups, popups, undefined]);
  });

  it("renders on the server without a crash", () => {
    const html = renderToString(
      <OuroProvider>
        <Link />
      </OuroProvider>,
    );
    expect(html).toBe('<a href="/recipes" class="mt-2">Recipes</a>');
  });

  it("installs the squircle capsule watcher once on mount, and stops it on unmount", async () => {
    vi.mocked(installSquircleCapsules).mockClear();
    const supports = vi.spyOn(CSS, "supports").mockImplementation((prop: string) => prop === "clip-path");
    const mutationObserve = vi.spyOn(MutationObserver.prototype, "observe");
    const mutationDisconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    await mount(<OuroProvider>content</OuroProvider>);
    await expect.poll(() => mutationObserve.mock.calls.length).toBe(1);
    expect(mutationObserve).toHaveBeenCalledExactlyOnceWith(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    // The provider's own gate reaches the import exactly once: it is what decides whether the chunk loads at all.
    expect(installSquircleCapsules).toHaveBeenCalledExactlyOnceWith(document);
    // The watcher is the fallback for exactly these two features, checked by their exact names. Positional,
    // not toHaveBeenCalledWith: the capsule watcher it loads makes this same pair of calls again once its
    // own module resolves, which would hide a mutated literal in the provider's own check.
    expect(supports.mock.calls[0]).toEqual(["corner-shape", "squircle"]);
    expect(supports.mock.calls[1]).toEqual(["clip-path", "shape(from 0 0, close)"]);
    const root = roots.at(-1)!;
    await act(async () => root.render(<OuroProvider>content changed</OuroProvider>));
    // A re-render does not install the watcher again.
    expect(mutationObserve).toHaveBeenCalledOnce();
    expect(mutationDisconnect).not.toHaveBeenCalled();
    await act(async () => roots.pop()!.unmount());
    expect(mutationDisconnect).toHaveBeenCalledOnce();
  });
});

describe("OuroProvider motion", () => {
  function Reduced({ id }: { id: string }) {
    return <output id={id}>{String(useReducedMotion())}</output>;
  }
  const answers = () => [...document.querySelectorAll("output")].map((output) => `${output.id}:${output.textContent}`);
  const settings = (
    <>
      <Reduced id="none" />
      <OuroProvider motion="system">
        <Reduced id="system" />
      </OuroProvider>
      <OuroProvider motion="reduced">
        <Reduced id="reduced" />
      </OuroProvider>
      <OuroProvider motion="full">
        <Reduced id="full" />
      </OuroProvider>
    </>
  );

  it("answers useReducedMotion by its motion, and by the device under system or no provider", async () => {
    await mount(settings);
    expect(answers()).toEqual(["none:false", "system:false", "reduced:true", "full:false"]);
    await commands.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(answers).toEqual(["none:true", "system:true", "reduced:true", "full:false"]);
  });

  it("marks its children's element with data-motion, adding no box, and adds no element without motion", async () => {
    const container = await mount(settings);
    const marked = [...container.querySelectorAll<HTMLElement>("[data-motion]")];
    expect(marked.map((element) => element.getAttribute("data-motion"))).toEqual(["system", "reduced", "full"]);
    for (const element of marked) expect(getComputedStyle(element).display).toBe("contents");
    expect(marked.map((element) => element.querySelector("output")!.id)).toEqual(["system", "reduced", "full"]);
    const plain = await mount(
      <OuroProvider>
        <Reduced id="plain" />
      </OuroProvider>,
    );
    expect(plain.firstElementChild!.tagName).toBe("OUTPUT");
  });

  it("passes a change of its motion on to what it wraps", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    roots.push(root);
    const at = (motion: "reduced" | "full") => (
      <OuroProvider motion={motion}>
        <Reduced id="changing" />
      </OuroProvider>
    );
    await act(async () => root.render(at("reduced")));
    expect(answers()).toEqual(["changing:true"]);
    await act(async () => root.render(at("full")));
    expect(answers()).toEqual(["changing:false"]);
  });

  it("keeps an outer provider's motion inside one that sets none", async () => {
    await mount(
      <OuroProvider motion="reduced">
        <OuroProvider>
          <Reduced id="inherited" />
        </OuroProvider>
        <OuroProvider motion="full">
          <Reduced id="overridden" />
        </OuroProvider>
      </OuroProvider>,
    );
    expect(answers()).toEqual(["inherited:true", "overridden:false"]);
  });

  it("ends CSS transitions at once under reduced, in a portal too, but not inside a provider set to full", async () => {
    const moving = "transition: opacity 1s, translate 1s; animation: none 2s";
    const container = await mount(
      <OuroProvider motion="reduced">
        <p id="inside" style={{ transition: "opacity 1s, translate 1s" }} />
        {createPortal(<p id="portal" style={{ transition: "opacity 1s" }} />, document.body)}
        <OuroProvider motion="full">
          <p id="full" style={{ transition: "opacity 1s" }} />
        </OuroProvider>
      </OuroProvider>,
    );
    const duration = (id: string) => getComputedStyle(document.getElementById(id)!).transitionDuration;
    expect([duration("inside"), duration("portal"), duration("full")]).toEqual(["0s", "0s", "1s"]);
    const elsewhere = document.body.appendChild(document.createElement("p"));
    elsewhere.style.cssText = moving;
    expect(getComputedStyle(elsewhere).animationDuration).toBe("0s");
    expect(getComputedStyle(elsewhere).scrollBehavior).toBe("auto");
    // Gone with the provider: the page moves again.
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    expect(getComputedStyle(elsewhere).transitionDuration).toBe("1s, 1s");
    expect(container.querySelector("style")).toBeNull();
  });

  it("warns of a motion that is not a setting, and follows the device", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const props = { motion: "still", children: <Reduced id="unknown" /> } as unknown as Parameters<typeof OuroProvider>[0];
    await mount(<OuroProvider {...props} />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] OuroProvider: motion="still" is not a setting; use "system", "reduced" or "full". Fix: <OuroProvider motion="reduced">.');
    expect(answers()).toEqual(["unknown:false"]);
    expect(document.querySelector("[data-motion]")!.getAttribute("data-motion")).toBe("system");
    await commands.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(answers).toEqual(["unknown:true"]);
  });

  it("renders its setting on the server", () => {
    const html = renderToString(
      <OuroProvider motion="reduced">
        <Link />
      </OuroProvider>,
    );
    expect(html).toContain('data-motion="reduced"');
    expect(html).toContain("transition-duration: 0s !important");
  });
});

describe("OuroProvider strictCsp", () => {
  const moving = () => {
    const element = document.body.appendChild(document.createElement("p"));
    element.style.transition = "opacity 1s";
    return element;
  };

  it("stills the page under reduced with a constructed stylesheet, not a <style>, and takes only its own away when motion changes or the provider goes", async () => {
    const theirs = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, theirs];
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    roots.push(root);
    const at = (motion: "reduced" | "full") => (
      <OuroProvider strictCsp motion={motion}>
        <Link />
      </OuroProvider>
    );
    await act(async () => root.render(at("reduced")));
    const elsewhere = moving();
    expect(container.querySelector("style")).toBeNull();
    expect(document.adoptedStyleSheets).toHaveLength(2);
    expect(getComputedStyle(elsewhere).transitionDuration).toBe("0s");
    await act(async () => root.render(at("full")));
    expect(document.adoptedStyleSheets).toEqual([theirs]);
    expect(getComputedStyle(elsewhere).transitionDuration).toBe("1s");
    await act(async () => root.render(at("reduced")));
    expect(document.adoptedStyleSheets).toHaveLength(2);
    await act(async () => roots.splice(0).forEach((each) => each.unmount()));
    expect(document.adoptedStyleSheets).toEqual([theirs]);
    expect(getComputedStyle(elsewhere).transitionDuration).toBe("1s");
    document.adoptedStyleSheets = [];
  });

  it("brings a <style> only for reduced motion without strictCsp", async () => {
    const container = await mount(
      <>
        <OuroProvider motion="system">
          <Link />
        </OuroProvider>
        <OuroProvider motion="full">
          <Link />
        </OuroProvider>
      </>,
    );
    expect(container.querySelector("style")).toBeNull();
  });

  const scrollStyles = () => [...document.querySelectorAll("style")].filter((style) => style.textContent.includes("base-ui-disable-scrollbar")).length;
  const area = (
    <ScrollArea.Root>
      <ScrollArea.Viewport>Notes</ScrollArea.Viewport>
    </ScrollArea.Root>
  );

  it("keeps an outer provider's strictCsp inside one that sets none, and lets an inner one turn it off", async () => {
    const sheets = document.adoptedStyleSheets.length;
    const scroll = scrollStyles();
    const container = await mount(
      <OuroProvider strictCsp>
        {area}
        <OuroProvider motion="reduced">
          {area}
          <span id="inherited" />
        </OuroProvider>
      </OuroProvider>,
    );
    expect(container.querySelector("style")).toBeNull();
    expect(scrollStyles()).toBe(scroll);
    expect(document.adoptedStyleSheets).toHaveLength(sheets + 1);
    const off = await mount(
      <OuroProvider strictCsp>
        <OuroProvider strictCsp={false} motion="reduced">
          {area}
        </OuroProvider>
      </OuroProvider>,
    );
    expect(off.querySelector("style")).not.toBeNull();
    expect(document.adoptedStyleSheets).toHaveLength(sheets + 1);
    expect(scrollStyles()).toBeGreaterThan(scroll);
  });

  it("tells the Base UI parts it wraps to add no <style>, and adds no stylesheet without reduced motion", async () => {
    const sheets = document.adoptedStyleSheets.length;
    const scroll = scrollStyles();
    await mount(<OuroProvider strictCsp>{area}</OuroProvider>);
    expect(scrollStyles()).toBe(scroll);
    expect(document.adoptedStyleSheets).toHaveLength(sheets);
    await mount(<OuroProvider motion="reduced">{area}</OuroProvider>);
    expect(document.adoptedStyleSheets).toHaveLength(sheets);
  });

  it("renders no <style> on the server", () => {
    const html = renderToString(
      <OuroProvider strictCsp motion="reduced">
        <Link />
      </OuroProvider>,
    );
    expect(html).toContain('data-motion="reduced"');
    expect(html).not.toContain("<style");
  });

  it("points Base UI's disableStyleElements to strictCsp", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const props = { disableStyleElements: true, children: <Link /> } as unknown as Parameters<typeof OuroProvider>[0];
    await mount(<OuroProvider {...props} />);
    expect(warn).toHaveBeenCalledWith("[ouro-ui] OuroProvider: disableStyleElements is not a prop. Fix: <OuroProvider strictCsp>.");
  });
});

describe("OuroProvider quiet", () => {
  function Quiet({ id }: { id: string }) {
    return <output data-testid={id}>{String(useOuro().quiet === true)}</output>;
  }
  const marked = () => document.documentElement.hasAttribute("data-ouro-quiet");
  const read = (container: Element, id: string) => container.querySelector(`[data-testid="${id}"]`)!.textContent;

  it("tells components the person asked for less, and marks the page while it is on", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => root.render(<Quiet id="none" />));
    expect(read(container, "none")).toBe("false");
    expect(marked()).toBe(false);
    await act(async () => root.render(<OuroProvider quiet><Quiet id="on" /></OuroProvider>));
    expect(read(container, "on")).toBe("true");
    expect(document.documentElement.getAttribute("data-ouro-quiet")).toBe("");
    await act(async () => root.render(<OuroProvider quiet={false}><Quiet id="off" /></OuroProvider>));
    expect(read(container, "off")).toBe("false");
    expect(marked()).toBe(false);
    await act(async () => root.render(<OuroProvider quiet><Quiet id="again" /></OuroProvider>));
    expect(marked()).toBe(true);
    await act(async () => root.unmount());
    expect(marked()).toBe(false);
  });

  it("keeps an outer provider's quiet inside one that sets none, and lets an inner one turn it off", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <OuroProvider quiet>
          <OuroProvider>
            <Quiet id="inherited" />
          </OuroProvider>
          <OuroProvider quiet={false}>
            <Quiet id="off" />
          </OuroProvider>
        </OuroProvider>,
      ),
    );
    expect(read(container, "inherited")).toBe("true");
    expect(read(container, "off")).toBe("false");
    await act(async () => root.unmount());
    expect(marked()).toBe(false);
  });

  it("keeps the page marked until the last quiet provider goes", async () => {
    const first = document.body.appendChild(document.createElement("div"));
    const second = document.body.appendChild(document.createElement("div"));
    const [a, b] = [createRoot(first), createRoot(second)];
    await act(async () => a.render(<OuroProvider quiet><Quiet id="a" /></OuroProvider>));
    await act(async () => b.render(<OuroProvider quiet><Quiet id="b" /></OuroProvider>));
    await act(async () => a.unmount());
    expect(marked()).toBe(true);
    await act(async () => b.unmount());
    expect(marked()).toBe(false);
  });

  it("hides what an app marks with data-ouro-quiet-hide, with the rule its docs give", async () => {
    const style = document.head.appendChild(document.createElement("style"));
    style.textContent = "[data-ouro-quiet] [data-ouro-quiet-hide] { display: none; }";
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    try {
      await act(async () => root.render(<OuroProvider quiet><span data-ouro-quiet-hide="">Riders</span></OuroProvider>));
      expect(getComputedStyle(container.querySelector("span")!).display).toBe("none");
      await act(async () => root.render(<OuroProvider><span data-ouro-quiet-hide="">Riders</span></OuroProvider>));
      expect(getComputedStyle(container.querySelector("span")!).display).toBe("inline");
    } finally {
      await act(async () => root.unmount());
      style.remove();
    }
  });

  it("loads no capsule watcher where corner-shape is drawn", async () => {
    vi.mocked(installSquircleCapsules).mockClear();
    const mutationObserve = vi.spyOn(MutationObserver.prototype, "observe");
    vi.spyOn(CSS, "supports").mockReturnValue(true);
    await mount(<OuroProvider>content</OuroProvider>);
    await import("~/lib/ouro/squircle-capsules");
    expect(mutationObserve).not.toHaveBeenCalled();
    // The provider's own gate never reaches the import: a mutant that always imports would still bail inside
    // installSquircleCapsules, hiding behind the MutationObserver check above, but never calls it at all.
    expect(installSquircleCapsules).not.toHaveBeenCalled();
  });
});
