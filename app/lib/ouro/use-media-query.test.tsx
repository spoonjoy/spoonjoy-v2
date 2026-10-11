import { createRoot } from "react-dom/client";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { page } from "vitest/browser";
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
    await vi.waitFor(() => expect(container.textContent).toBe("false"));
    await page.viewport(1000, 800);
    await vi.waitFor(() => expect(container.textContent).toBe("true"));
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
});
