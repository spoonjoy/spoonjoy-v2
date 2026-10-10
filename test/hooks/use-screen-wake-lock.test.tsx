import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useScreenWakeLock } from "~/hooks/use-screen-wake-lock";

function sentinel() {
  const value = {
    released: false,
    release: vi.fn(() => {
      value.released = true;
      return Promise.resolve();
    }),
  };
  return value;
}

function installWakeLock(request: (type: "screen") => Promise<ReturnType<typeof sentinel>>) {
  const api = { request: vi.fn(request) };
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: api });
  return api;
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useScreenWakeLock", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "wakeLock");
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("holds the screen awake while active and releases it when cook mode closes", async () => {
    const held = sentinel();
    const api = installWakeLock(() => Promise.resolve(held));
    const { rerender } = renderHook(({ active }) => useScreenWakeLock(active), { initialProps: { active: true } });
    await flush();
    expect(api.request).toHaveBeenCalledWith("screen");
    rerender({ active: false });
    expect(held.release).toHaveBeenCalledTimes(1);
  });

  it("asks again when the cook comes back to the tab after the browser dropped the lock", async () => {
    const first = sentinel();
    const second = sentinel();
    const api = installWakeLock(vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second));
    const { unmount } = renderHook(() => useScreenWakeLock(true));
    await flush();
    // Still held: a visibility change does not stack a second lock.
    act(() => setVisibility("visible"));
    await flush();
    expect(api.request).toHaveBeenCalledTimes(1);

    first.released = true;
    act(() => setVisibility("hidden"));
    await flush();
    expect(api.request).toHaveBeenCalledTimes(1);
    act(() => setVisibility("visible"));
    await flush();
    expect(api.request).toHaveBeenCalledTimes(2);
    unmount();
    expect(second.release).toHaveBeenCalledTimes(1);
  });

  it("releases a lock that arrives after cook mode already closed", async () => {
    const late = sentinel();
    let resolve: (value: ReturnType<typeof sentinel>) => void = () => undefined;
    installWakeLock(() => new Promise((next) => {
      resolve = next;
    }));
    const { unmount } = renderHook(() => useScreenWakeLock(true));
    unmount();
    resolve(late);
    await flush();
    expect(late.release).toHaveBeenCalledTimes(1);
  });

  it("tolerates a late lock whose release fails", async () => {
    const late = sentinel();
    late.release.mockImplementation(() => Promise.reject(new Error("gone")));
    let resolve: (value: ReturnType<typeof sentinel>) => void = () => undefined;
    installWakeLock(() => new Promise((next) => {
      resolve = next;
    }));
    const { unmount } = renderHook(() => useScreenWakeLock(true));
    unmount();
    resolve(late);
    await flush();
    expect(late.release).toHaveBeenCalledTimes(1);
  });

  it("does not release a lock the browser already released, and ignores failed releases", async () => {
    const held = sentinel();
    installWakeLock(() => Promise.resolve(held));
    const first = renderHook(() => useScreenWakeLock(true));
    await flush();
    held.released = true;
    first.unmount();
    expect(held.release).not.toHaveBeenCalled();

    const failing = sentinel();
    failing.release.mockImplementation(() => Promise.reject(new Error("gone")));
    installWakeLock(() => Promise.resolve(failing));
    const second = renderHook(() => useScreenWakeLock(true));
    await flush();
    second.unmount();
    await flush();
    expect(failing.release).toHaveBeenCalledTimes(1);
  });

  it("does nothing when refused, unsupported, inactive or hidden", async () => {
    const refused = installWakeLock(() => Promise.reject(new DOMException("NotAllowedError")));
    const refusedHook = renderHook(() => useScreenWakeLock(true));
    await flush();
    expect(refused.request).toHaveBeenCalledTimes(1);
    refusedHook.unmount();

    const inactive = installWakeLock(() => Promise.resolve(sentinel()));
    renderHook(() => useScreenWakeLock(false)).unmount();
    expect(inactive.request).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    const hidden = installWakeLock(() => Promise.resolve(sentinel()));
    renderHook(() => useScreenWakeLock(true)).unmount();
    expect(hidden.request).not.toHaveBeenCalled();

    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: {} });
    expect(() => renderHook(() => useScreenWakeLock(true)).unmount()).not.toThrow();
    Reflect.deleteProperty(navigator, "wakeLock");
    expect(() => renderHook(() => useScreenWakeLock(true)).unmount()).not.toThrow();
  });
});
