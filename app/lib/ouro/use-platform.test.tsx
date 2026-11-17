import { renderToString } from "react-dom/server";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "~/lib/ouro/testing/act";
import { usePlatform } from "~/lib/ouro/use-platform";

/** Shows the platform the hook reads. */
function PlatformProbe() {
  return <output>{usePlatform()}</output>;
}

/** Pretends the browser runs on a Mac, through the legacy API. */
function onMac() {
  Object.defineProperty(navigator, "userAgentData", { configurable: true, value: undefined });
  Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
}

const mounted: Element[] = [];
const roots: Root[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted.splice(0)) node.remove();
  delete (navigator as { userAgentData?: unknown }).userAgentData;
  delete (navigator as { platform?: unknown }).platform;
});

describe("usePlatform", () => {
  it("reads the browser's platform on a client render", async () => {
    onMac();
    const host = document.createElement("div");
    document.body.append(host);
    mounted.push(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<PlatformProbe />));
    expect(host.textContent).toBe("apple");
  });

  it("renders unknown on the server, where the platform is not known", () => {
    onMac();
    expect(renderToString(<PlatformProbe />)).toBe("<output>unknown</output>");
  });

  it("hydrates the server's unknown without a mismatch, then shows the platform", async () => {
    onMac();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = document.createElement("div");
    host.innerHTML = renderToString(<PlatformProbe />);
    document.body.append(host);
    mounted.push(host);
    const recoverable = vi.fn();
    await act(async () => {
      roots.push(hydrateRoot(host, <PlatformProbe />, { onRecoverableError: recoverable }));
    });
    expect(host.textContent).toBe("apple");
    expect(recoverable).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
