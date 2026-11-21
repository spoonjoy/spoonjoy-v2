import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLoadingVisible } from "~/lib/ouro/use-loading-visible";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
const nodes: Element[] = [];

type Options = Parameters<typeof useLoadingVisible>[1];

function Probe({ loading, options = { delay: 100, minVisible: 300 } }: { loading: boolean; options?: Options | null }) {
  const visible = useLoadingVisible(loading, options ?? undefined);
  return <span data-visible={String(visible)} />;
}

async function mount(loading: boolean, options?: Options | null) {
  const host = document.createElement("div");
  document.body.append(host);
  nodes.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<Probe loading={loading} options={options} />));
  return {
    set: (next: boolean) => act(async () => root.render(<Probe loading={next} options={options} />)),
    visible: () => host.firstElementChild!.getAttribute("data-visible"),
    tick: (ms: number) => act(async () => void vi.advanceTimersByTime(ms)),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  nodes.splice(0).forEach((node) => node.remove());
});

describe("useLoadingVisible", () => {
  it("shows nothing for a load that ends within the delay", async () => {
    const view = await mount(true);
    await view.tick(99);
    expect(view.visible()).toBe("false");
    await view.set(false);
    await view.tick(1000);
    expect(view.visible()).toBe("false");
  });

  it("shows once a load has run for the delay", async () => {
    const view = await mount(true);
    await view.tick(100);
    expect(view.visible()).toBe("true");
  });

  it("keeps a shown placeholder until it has been up for the minimum, then hides it", async () => {
    const view = await mount(true);
    await view.tick(100);
    await view.tick(150);
    await view.set(false);
    await view.tick(149);
    expect(view.visible()).toBe("true");
    await view.tick(1);
    expect(view.visible()).toBe("false");
  });

  it("hides at once when the minimum has already passed", async () => {
    const view = await mount(true);
    await view.tick(100);
    await view.tick(400);
    await view.set(false);
    await view.tick(0);
    expect(view.visible()).toBe("false");
  });

  it("stays shown when a load restarts during the hold", async () => {
    const view = await mount(true);
    await view.tick(100);
    await view.set(false);
    await view.tick(100);
    await view.set(true);
    await view.tick(1000);
    expect(view.visible()).toBe("true");
  });

  it("waits 200 ms to show and holds 500 ms when no options are given", async () => {
    const view = await mount(true, null);
    await view.tick(199);
    expect(view.visible()).toBe("false");
    await view.tick(1);
    expect(view.visible()).toBe("true");
    await view.set(false);
    await view.tick(499);
    expect(view.visible()).toBe("true");
    await view.tick(1);
    expect(view.visible()).toBe("false");
  });

  it("takes each option on its own, the other keeping its default", async () => {
    const delayed = await mount(true, { delay: 50 });
    await delayed.tick(50);
    expect(delayed.visible()).toBe("true");
    await delayed.set(false);
    await delayed.tick(499);
    expect(delayed.visible()).toBe("true");
    const held = await mount(true, { minVisible: 10 });
    await held.tick(200);
    expect(held.visible()).toBe("true");
    await held.set(false);
    await held.tick(10);
    expect(held.visible()).toBe("false");
  });
});
