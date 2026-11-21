import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Link } from "~/components/ouro/link/link";
import { act } from "~/lib/ouro/testing/act";
import { usePrefetchIntent } from "~/lib/ouro/use-prefetch-intent";

const roots: Root[] = [];
const nodes: Element[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  for (const node of nodes.splice(0)) node.remove();
});

function PrefetchLink({ prefetch }: { prefetch: (href: string) => unknown }) {
  return (
    <Link href="/recipes" {...usePrefetchIntent(prefetch, "/recipes")}>
      Recipes
    </Link>
  );
}

describe("Link prefetch", () => {
  it("prefetches its route on focus and on touch start when the hook's handlers are spread on it", async () => {
    const prefetch = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    nodes.push(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<PrefetchLink prefetch={prefetch} />));
    const link = host.querySelector("a")!;
    await act(async () => link.dispatchEvent(new Event("touchstart", { bubbles: true })));
    expect(prefetch).toHaveBeenCalledExactlyOnceWith("/recipes");
    await act(async () => link.dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
    expect(prefetch).toHaveBeenCalledTimes(1);
  });
});
