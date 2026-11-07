import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "~/lib/ouro/testing/act";
import { useInstallPrompt, type InstallPromptOptions, type InstallPromptState } from "~/lib/ouro/use-install-prompt";

// The module keeps the browser's offer for the whole page, so these tests run in order and
// each one uses up the offer it makes.

const roots: Root[] = [];
const nodes: Element[] = [];

/** Fires the browser's install event, with a dialog that answers `outcome` or fails to open. */
function offer(outcome: "accepted" | "dismissed" = "dismissed", fails = false) {
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: vi.fn(() => (fails ? Promise.reject(new Error("Already shown")) : Promise.resolve())),
    userChoice: Promise.resolve({ outcome }),
  });
  window.dispatchEvent(event);
  return event;
}

async function probe(options?: InstallPromptOptions) {
  const state = {} as { current: InstallPromptState };
  function Probe() {
    state.current = useInstallPrompt(options);
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  nodes.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<Probe />));
  return state;
}

afterEach(async () => {
  vi.restoreAllMocks();
  localStorage.removeItem("ouro-install-dismissed");
  localStorage.removeItem("notes-install");
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of nodes.splice(0)) node.remove();
});

describe("useInstallPrompt", () => {
  it("is not available, and install() says so, until the browser offers to install", async () => {
    const state = await probe();
    expect(state.current.available).toBe(false);
    expect(state.current.installed).toBe(false);
    await expect(state.current.install()).resolves.toBe("unavailable");
  });

  it("catches the browser's offer, keeps the browser from showing its own, and opens it on install()", async () => {
    const state = await probe();
    let event!: ReturnType<typeof offer>;
    await act(async () => void (event = offer("dismissed")));
    expect(event.defaultPrevented).toBe(true);
    expect(state.current.available).toBe(true);
    let outcome: string | undefined;
    await act(async () => void (outcome = await state.current.install()));
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(outcome).toBe("dismissed");
    // The browser's offer is used once, whatever the answer.
    expect(state.current.available).toBe(false);
    expect(state.current.installed).toBe(false);
  });

  it("is available to a component that mounts after the offer", async () => {
    offer();
    const state = await probe();
    expect(state.current.available).toBe(true);
    await act(async () => void (await state.current.install()));
  });

  it("puts the offer away on dismiss(), and keeps it away for remindAfterDays", async () => {
    offer();
    const state = await probe();
    const before = Date.now();
    await act(async () => state.current.dismiss());
    expect(state.current.available).toBe(false);
    expect(Number(localStorage.getItem("ouro-install-dismissed"))).toBeGreaterThanOrEqual(before);
    expect((await probe()).current.available).toBe(false);
    expect((await probe({ remindAfterDays: 0 })).current.available).toBe(true);
    expect((await probe({ storageKey: "notes-install" })).current.available).toBe(true);
    localStorage.setItem("ouro-install-dismissed", String(Date.now() - 15 * 24 * 60 * 60 * 1000));
    expect((await probe()).current.available).toBe(true);
    await act(async () => void (await state.current.install()));
  });

  it("ignores a stored value that is not a time", async () => {
    offer();
    localStorage.setItem("ouro-install-dismissed", "never");
    const state = await probe();
    expect(state.current.available).toBe(true);
    await act(async () => void (await state.current.install()));
  });

  it("still offers, and hides the offer on this page, where storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    offer();
    const state = await probe();
    expect(state.current.available).toBe(true);
    await act(async () => state.current.dismiss());
    expect(state.current.available).toBe(false);
    await act(async () => void (await state.current.install()));
  });

  it("says dismissed when the browser's dialog cannot open", async () => {
    offer("accepted", true);
    const state = await probe();
    let outcome: string | undefined;
    await act(async () => void (outcome = await state.current.install()));
    expect(outcome).toBe("dismissed");
    expect(state.current.installed).toBe(false);
  });

  it("is installed, and offers nothing, while the app runs standalone", async () => {
    const real = window.matchMedia.bind(window);
    vi.spyOn(window, "matchMedia").mockImplementation((query) =>
      real(query === "(display-mode: standalone)" ? "(min-width: 0px)" : query),
    );
    offer();
    const state = await probe();
    expect(state.current.installed).toBe(true);
    expect(state.current.available).toBe(false);
    await act(async () => void (await state.current.install()));
  });

  it("is installed once the browser says the app was installed from this page", async () => {
    const state = await probe();
    await act(async () => void offer());
    expect(state.current.available).toBe(true);
    await act(async () => void window.dispatchEvent(new Event("appinstalled")));
    expect(state.current.installed).toBe(true);
    expect(state.current.available).toBe(false);
    await expect(state.current.install()).resolves.toBe("unavailable");
  });

  it("resolves accepted when the person installs", async () => {
    const state = await probe();
    await act(async () => void offer("accepted"));
    let outcome: string | undefined;
    await act(async () => void (outcome = await state.current.install()));
    expect(outcome).toBe("accepted");
    expect(state.current.installed).toBe(true);
  });

  it("offers nothing on the server", () => {
    let seen: InstallPromptState | undefined;
    function Probe() {
      seen = useInstallPrompt();
      return null;
    }
    renderToString(<Probe />);
    expect(seen).toMatchObject({ available: false, installed: false });
  });
});
