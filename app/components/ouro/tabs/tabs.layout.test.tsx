import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { TabsIndicator, TabsList, TabsPanel, TabsRoot, TabsTab } from "~/components/ouro/tabs/tabs-parts";
import { act } from "~/lib/ouro/testing/act";
import { watchLayoutReads } from "~/lib/ouro/testing/layout-reads";

const roots: Root[] = [];
const hosts: Element[] = [];

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  hosts.splice(0).forEach((host) => host.remove());
});

function Screen({ count }: { count: number }) {
  return (
    <div data-count={count}>
      <TabsRoot defaultValue="a">
        <TabsList aria-label="Sections">
          <TabsTab value="a">A</TabsTab>
          <TabsTab value="b">B</TabsTab>
          <TabsIndicator />
        </TabsList>
        <TabsPanel value="a">Panel</TabsPanel>
      </TabsRoot>
    </div>
  );
}

describe("Tabs layout reads", () => {
  it("measures the indicator again only when something it follows changes, not on a commit that moves nothing", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<Screen count={0} />));
    // Base UI's TabsList observes the list's size, and a ResizeObserver reports once after it starts
    // observing, at the next rendering step: the indicator measures then. Let that pass first, so the
    // watch sees only what the commits below cause, not a first report that came late.
    const observed = new Promise<void>((resolve) => {
      const observer = new ResizeObserver(() => (observer.disconnect(), resolve()));
      observer.observe(host.querySelector("[role='tablist']")!);
    });
    await act(async () => {
      await observed;
      await new Promise((frame) => requestAnimationFrame(() => requestAnimationFrame(frame)));
    });
    const watch = watchLayoutReads();
    await act(async () => root.render(<Screen count={1} />));
    await act(async () => root.render(<Screen count={2} />));
    expect(watch.names()).toEqual([]);
  });
});
