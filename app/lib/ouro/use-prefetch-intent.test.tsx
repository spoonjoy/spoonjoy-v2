import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePrefetchIntent } from "~/lib/ouro/use-prefetch-intent";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
const nodes: Element[] = [];

function Target({ id, prefetch }: { id: string; prefetch: ((key: string) => unknown) | undefined }) {
  const intent = usePrefetchIntent(prefetch, id, { delay: 50, maxInflight: 1, staleAfter: 1000 });
  return (
    <button data-id={id} {...intent}>
      {id}
    </button>
  );
}

async function mount(prefetch: ((key: string) => unknown) | undefined, ids = ["a"]) {
  const host = document.createElement("div");
  document.body.append(host);
  nodes.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <>
        {ids.map((id) => (
          <Target key={id} id={id} prefetch={prefetch} />
        ))}
      </>,
    ),
  );
  return (id: string) => host.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
}

const pointer = (el: Element, type: "pointerover" | "pointerout", pointerType = "mouse") =>
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType, relatedTarget: null }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  for (const node of nodes.splice(0)) node.remove();
});

describe("usePrefetchIntent", () => {
  it("prefetches when a mouse rests on the target, not when it only passes over", async () => {
    const prefetch = vi.fn();
    const get = await mount(prefetch);
    await act(async () => pointer(get("a"), "pointerover"));
    await act(async () => void vi.advanceTimersByTime(49));
    expect(prefetch).not.toHaveBeenCalled();
    await act(async () => void vi.advanceTimersByTime(1));
    expect(prefetch).toHaveBeenCalledExactlyOnceWith("a");
    prefetch.mockClear();
    vi.setSystemTime(Date.now() + 5000);
    await act(async () => pointer(get("a"), "pointerover"));
    await act(async () => pointer(get("a"), "pointerout"));
    await act(async () => void vi.advanceTimersByTime(200));
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("prefetches at once on focus and on touch start, and ignores a touch's pointer rest", async () => {
    const prefetch = vi.fn();
    const get = await mount(prefetch, ["a", "b"]);
    await act(async () => get("a").dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
    expect(prefetch).toHaveBeenCalledExactlyOnceWith("a");
    await act(async () => void vi.advanceTimersByTime(0));
    await act(async () => pointer(get("b"), "pointerover", "touch"));
    await act(async () => void vi.advanceTimersByTime(200));
    expect(prefetch).toHaveBeenCalledTimes(1);
    await act(async () => get("b").dispatchEvent(new Event("touchstart", { bubbles: true })));
    expect(prefetch).toHaveBeenLastCalledWith("b");
  });

  it("prefetches a key once until it goes stale, then again", async () => {
    const prefetch = vi.fn();
    const get = await mount(prefetch);
    const focus = () => act(async () => get("a").dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
    await focus();
    await focus();
    expect(prefetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 1001);
    await focus();
    expect(prefetch).toHaveBeenCalledTimes(2);
  });

  it("runs at most maxInflight prefetches at once and lets the next intent retry the one it skipped", async () => {
    let finish!: () => void;
    const prefetch = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const get = await mount(prefetch, ["a", "b"]);
    const focus = (id: string) => act(async () => get(id).dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
    await focus("a");
    await focus("b");
    expect(prefetch).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await focus("b");
    expect(prefetch).toHaveBeenCalledTimes(2);
    expect(prefetch).toHaveBeenLastCalledWith("b");
  });

  it("prefetches nothing when the browser asks to save data", async () => {
    vi.stubGlobal("navigator", Object.create(navigator, { connection: { value: { saveData: true } } }));
    const prefetch = vi.fn();
    const get = await mount(prefetch);
    await act(async () => get("a").dispatchEvent(new Event("touchstart", { bubbles: true })));
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("swallows a failed prefetch, and retries it on the next intent", async () => {
    const prefetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementationOnce(() => {
      throw new Error("sync");
    });
    const get = await mount(prefetch);
    const touch = () => act(async () => get("a").dispatchEvent(new Event("touchstart", { bubbles: true })));
    await touch();
    await touch();
    await touch();
    expect(prefetch).toHaveBeenCalledTimes(3);
    await touch();
    expect(prefetch).toHaveBeenCalledTimes(3);
  });

  it("prefetches again once exactly staleAfter has passed", async () => {
    const prefetch = vi.fn();
    const get = await mount(prefetch);
    const focus = () => act(async () => get("a").dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
    await focus();
    vi.setSystemTime(Date.now() + 1000);
    await focus();
    expect(prefetch).toHaveBeenCalledTimes(2);
  });

  it("prefetches when the browser reports no connection information", async () => {
    vi.stubGlobal("navigator", Object.create(navigator, { connection: { value: undefined } }));
    const prefetch = vi.fn();
    const get = await mount(prefetch);
    await act(async () => get("a").dispatchEvent(new Event("touchstart", { bubbles: true })));
    expect(prefetch).toHaveBeenCalledTimes(1);
  });

  it("does nothing, and does not throw, when the app gives no function", async () => {
    const get = await mount(undefined);
    await act(async () => get("a").dispatchEvent(new Event("touchstart", { bubbles: true })));
    expect(get("a")).not.toBeNull();
  });

  it("rests again from the latest pointer entry, and leaving cancels every pending rest", async () => {
    const prefetch = vi.fn();
    const get = await mount(prefetch);
    await act(async () => pointer(get("a"), "pointerover"));
    await act(async () => void vi.advanceTimersByTime(30));
    await act(async () => pointer(get("a"), "pointerover"));
    await act(async () => void vi.advanceTimersByTime(10));
    await act(async () => pointer(get("a"), "pointerout"));
    await act(async () => void vi.advanceTimersByTime(200));
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("cancels a pending rest when the target unmounts", async () => {
    const prefetch = vi.fn();
    const get = await mount(prefetch);
    await act(async () => pointer(get("a"), "pointerover"));
    for (const root of roots.splice(0)) await act(async () => root.unmount());
    await act(async () => void vi.advanceTimersByTime(200));
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("follows a changed key and a changed function", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    nodes.push(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<Target id="a" prefetch={first} />));
    await act(async () => root.render(<Target id="b" prefetch={first} />));
    await act(async () => host.querySelector("button")!.dispatchEvent(new Event("touchstart", { bubbles: true })));
    expect(first).toHaveBeenCalledExactlyOnceWith("b");
    await act(async () => root.render(<Target id="b" prefetch={second} />));
    await act(async () => host.querySelector("button")!.dispatchEvent(new Event("touchstart", { bubbles: true })));
    expect(second).toHaveBeenCalledExactlyOnceWith("b");
  });
});
