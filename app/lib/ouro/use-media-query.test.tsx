import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { commands, page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "~/lib/ouro/use-media-query";
import { act } from "~/lib/ouro/testing/act";


function Probe({ query = "(min-width: 640px)", serverDefault }: { query?: string; serverDefault: boolean }) {
  const matches = useMediaQuery(query, serverDefault);
  return <span data-testid="probe">{String(matches)}</span>;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("useMediaQuery", () => {
  it("returns serverDefault from renderToString, whatever the viewport", async () => {
    await page.viewport(1000, 800);
    expect(renderToString(<Probe serverDefault={false} />)).toContain("false");
    expect(renderToString(<Probe serverDefault />)).toContain("true");
  });

  it("returns the live value on the client and follows viewport changes", async () => {
    await page.viewport(1000, 800);
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => root.render(<Probe serverDefault={false} />));
    expect(container.textContent).toBe("true");
    await page.viewport(400, 800);
    await vi.waitFor(() => expect(container.textContent).toBe("false"), { timeout: 10_000 });
    await page.viewport(1000, 800);
    await vi.waitFor(() => expect(container.textContent).toBe("true"), { timeout: 10_000 });
    await act(async () => root.unmount());
  });

  it("hydrates without a warning even when the server default differs", async () => {
    await page.viewport(400, 800);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const container = document.body.appendChild(document.createElement("div"));
    container.innerHTML = renderToString(<Probe serverDefault />);
    expect(container.textContent).toBe("true");
    await act(async () => {
      hydrateRoot(container, <Probe serverDefault />);
    });
    expect(container.textContent).toBe("false");
    expect(error).not.toHaveBeenCalled();
  });

  it("falls back to serverDefault where matchMedia is missing", async () => {
    vi.stubGlobal("matchMedia", undefined);
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => root.render(<Probe serverDefault />));
    expect(container.textContent).toBe("true");
    await act(async () => root.unmount());
  });

  it("switches subscription when the query changes", async () => {
    await page.viewport(1000, 800);
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => root.render(<Probe serverDefault={false} />));
    expect(container.textContent).toBe("true");
    await act(async () => root.render(<Probe query="(min-width: 5000px)" serverDefault />));
    expect(container.textContent).toBe("false");
    await act(async () => root.unmount());
  });

  it("calls matchMedia once for a query in a render, however many components read it", async () => {
    await page.viewport(1000, 800);
    const query = "(min-width: 641px)";
    // A plain wrapper that counts the calls and answers with the browser's lists.
    const real = window.matchMedia.bind(window);
    let calls = 0;
    vi.stubGlobal("matchMedia", (asked: string) => {
      if (asked === query) calls++;
      return real(asked);
    });
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const probes = (n: number) => Array.from({ length: n }, (_, at) => <Probe key={at} query={query} serverDefault={false} />);
    await act(async () => root.render(<>{probes(8)}</>));
    expect(container.textContent).toBe("true".repeat(8));
    expect(calls).toBe(1);
    await act(async () => root.render(<>{probes(12)}</>));
    expect(calls).toBe(2);
    await page.viewport(400, 800);
    await vi.waitFor(() => expect(container.textContent).toBe("false".repeat(12)), { timeout: 10_000 });
    await act(async () => root.unmount());
  });

  it("follows a spy on matchMedia that passed the browser's lists through and then changes its answer", async () => {
    await page.viewport(1000, 800);
    const query = "(min-width: 645px)";
    const real = window.matchMedia.bind(window);
    const spy = vi.spyOn(window, "matchMedia");
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => root.render(<Probe query={query} serverDefault={false} />));
    expect(container.textContent).toBe("true");
    await act(async () => root.unmount());
    spy.mockImplementation((asked) => ({ ...real(asked), matches: false, media: asked, addEventListener() {}, removeEventListener() {} }) as MediaQueryList);
    const again = createRoot(container);
    await act(async () => again.render(<Probe query={query} serverDefault />));
    expect(container.textContent).toBe("false");
    await act(async () => again.unmount());
  });

  it("reads the answer a change reports in the task a render read the query in, as a stub that calls its listeners does", async () => {
    const query = "(min-width: 646px)";
    let matches = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", (asked: string) => ({
      matches,
      media: asked,
      addEventListener: (type: string, listener: () => void) => type === "change" && listeners.add(listener),
      removeEventListener: (type: string, listener: () => void) => type === "change" && listeners.delete(listener),
    }));
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => root.render(<Probe query={query} serverDefault />));
    expect(container.textContent).toBe("false");
    await act(async () => {
      // A render reads the query, and the media changes, in one task.
      flushSync(() => root.render(<Probe query={query} serverDefault={false} />));
      matches = true;
      for (const listener of listeners) listener();
    });
    expect(container.textContent).toBe("true");
    await act(async () => root.unmount());
    // Unmounted, it listens no more.
    expect(listeners.size).toBe(0);
  });

  it("asks a stub that answers with plain objects again for a render in the same task, so one whose answer changed is followed", async () => {
    const query = "(min-width: 647px)";
    let matches = false;
    vi.stubGlobal("matchMedia", (asked: string) => ({ matches, media: asked, addEventListener() {}, removeEventListener() {} }));
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    let first = "";
    await act(async () => {
      // Two renders in one task, as a synchronous test's render and rerender are, with the stub's answer changed between them.
      flushSync(() => root.render(<Probe query={query} serverDefault />));
      first = container.textContent!;
      matches = true;
      flushSync(() => root.render(<Probe query={query} serverDefault={false} />));
    });
    expect(first).toBe("false");
    expect(container.textContent).toBe("true");
    await act(async () => root.unmount());
  });

  it("asks a matchMedia swapped in within the task another made a list in", async () => {
    await page.viewport(1000, 800);
    const query = "(min-width: 648px)";
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    let first = "";
    await act(async () => {
      flushSync(() => root.render(<Probe query={query} serverDefault={false} />));
      first = container.textContent!;
      const real = window.matchMedia.bind(window);
      // A real list, of a query that does not match: only a lookup by the new matchMedia finds it.
      vi.stubGlobal("matchMedia", () => real("(min-width: 100000px)"));
      flushSync(() => root.render(<Probe query={query} serverDefault />));
    });
    expect(first).toBe("true");
    expect(container.textContent).toBe("false");
    await act(async () => root.unmount());
  });

  it("reads a change of the media in the next task, before the browser has drawn a frame, as WebKit's lists made earlier do not", async () => {
    const query = "(prefers-reduced-motion: reduce)";
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => root.render(<Probe query={query} serverDefault />));
    expect(container.textContent).toBe("false");
    await act(async () => root.unmount());
    await commands.emulateMedia({ reducedMotion: "reduce" });
    const again = createRoot(container);
    await act(async () => again.render(<Probe query={query} serverDefault={false} />));
    expect(container.textContent).toBe("true");
    await act(async () => again.unmount());
  });

  it("reads a matchMedia swapped in after the real one made a list for the same query, as a test's stub is", async () => {
    await page.viewport(1000, 800);
    const query = "(min-width: 642px)";
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => root.render(<Probe query={query} serverDefault={false} />));
    expect(container.textContent).toBe("true");
    await act(async () => root.unmount());
    vi.stubGlobal("matchMedia", (asked: string) => ({ matches: false, media: asked, addEventListener() {}, removeEventListener() {} }));
    const again = createRoot(container);
    await act(async () => again.render(<Probe query={query} serverDefault />));
    expect(container.textContent).toBe("false");
    await act(async () => again.unmount());
  });

  it("reads a mocked matchMedia where MediaQueryList is not defined, as in jsdom", async () => {
    vi.stubGlobal("MediaQueryList", undefined);
    vi.stubGlobal("matchMedia", (asked: string) => ({ matches: true, media: asked, addEventListener() {}, removeEventListener() {} }));
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    await act(async () => root.render(<Probe query="(min-width: 644px)" serverDefault={false} />));
    expect(container.textContent).toBe("true");
    await act(async () => root.unmount());
  });
});
