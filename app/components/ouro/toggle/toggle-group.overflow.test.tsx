import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { ToggleGroup, type ToggleGroupItem } from "~/components/ouro/toggle/toggle-group";
import { act } from "~/lib/ouro/testing/act";
import { pressTab } from "~/lib/ouro/testing/tab";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.padding = "8px";
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    rerender: (next: ReactNode) => act(async () => root.render(next)),
    get row() {
      return host.querySelector<HTMLElement>('[role="group"]')!;
    },
    get toggles() {
      return [...host.querySelectorAll<HTMLButtonElement>("button")];
    },
  };
}

beforeEach(async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await page.viewport(1024, 768);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await page.viewport(1024, 768);
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

const filters: ToggleGroupItem[] = [
  { value: "all", label: "All conversations" },
  { value: "unread", label: "Unread messages" },
  { value: "flagged", label: "Flagged for follow-up" },
  { value: "archived", label: "Archived threads" },
  { value: "drafts", label: "Saved drafts" },
];

describe("ToggleGroup overflow scroll", () => {
  it("stays one line tall, narrower than the toggles, instead of wrapping", async () => {
    await page.viewport(320, 400);
    const { row, toggles } = await render(
      <ToggleGroup label="Show" hideLabel overflow="scroll" items={filters} value="all" onValueChange={() => {}} />,
    );
    expect(row.scrollWidth).toBeGreaterThan(row.clientWidth);
    const rowHeight = row.getBoundingClientRect().height;
    const toggleHeight = toggles[0]!.getBoundingClientRect().height;
    expect(rowHeight).toBeLessThanOrEqual(toggleHeight + 2);
  });

  it("brings the last toggle fully into view when End moves focus to it", async () => {
    await page.viewport(320, 400);
    const { row, toggles } = await render(
      <ToggleGroup label="Show" hideLabel overflow="scroll" items={filters} value="all" onValueChange={() => {}} />,
    );
    await pressTab();
    expect(document.activeElement).toBe(toggles[0]);
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    await expect.poll(() => document.activeElement).toBe(toggles.at(-1));
    const box = row.getBoundingClientRect();
    const at = toggles.at(-1)!.getBoundingClientRect();
    await expect.poll(() => at.left >= box.left - 1 && at.right <= box.right + 1).toBe(true);
  });

  it("scrolls the pressed toggle into view when the value changes", async () => {
    await page.viewport(320, 400);
    const { row, rerender, toggles } = await render(
      <ToggleGroup label="Show" hideLabel overflow="scroll" items={filters} value="all" onValueChange={() => {}} />,
    );
    expect(row.scrollLeft).toBe(0);
    await rerender(
      <ToggleGroup label="Show" hideLabel overflow="scroll" items={filters} value="drafts" onValueChange={() => {}} />,
    );
    const box = row.getBoundingClientRect();
    const at = toggles.at(-1)!.getBoundingClientRect();
    await expect.poll(() => at.left >= box.left - 1 && at.right <= box.right + 1).toBe(true);
  });

  it("asks the browser to scroll the pressed toggle fully into view, not just closer", async () => {
    const spy = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = spy;
    try {
      await page.viewport(320, 400);
      const { rerender } = await render(
        <ToggleGroup label="Show" hideLabel overflow="scroll" items={filters} value="all" onValueChange={() => {}} />,
      );
      spy.mockClear();
      await rerender(
        <ToggleGroup label="Show" hideLabel overflow="scroll" items={filters} value="drafts" onValueChange={() => {}} />,
      );
      expect(spy).toHaveBeenCalledWith({ inline: "nearest", block: "nearest" });
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  it("re-scrolls on a multiple value change that joins to the same string without a separator", async () => {
    const collisionItems: ToggleGroupItem[] = [
      { value: "a", label: "A" },
      { value: "ab", label: "AB" },
      { value: "bc", label: "BC" },
      { value: "c", label: "C" },
    ];
    const spy = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = spy;
    try {
      await page.viewport(320, 400);
      const { rerender } = await render(
        <ToggleGroup
          label="Show"
          hideLabel
          multiple
          overflow="scroll"
          items={collisionItems}
          value={["a", "bc"]}
          onValueChange={() => {}}
        />,
      );
      spy.mockClear();
      // "a" + "bc" and "ab" + "c" join to the same "abc" with no separator between values.
      await rerender(
        <ToggleGroup
          label="Show"
          hideLabel
          multiple
          overflow="scroll"
          items={collisionItems}
          value={["ab", "c"]}
          onValueChange={() => {}}
        />,
      );
      expect(spy).toHaveBeenCalledWith({ inline: "nearest", block: "nearest" });
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  it("mounts with nothing pressed without throwing", async () => {
    await page.viewport(320, 400);
    const { toggles } = await render(
      <ToggleGroup label="Show" hideLabel overflow="scroll" items={filters} value={undefined} onValueChange={() => {}} />,
    );
    expect(toggles.length).toBe(filters.length);
  });

  it("asks the browser to scroll the arrow-focused toggle into view, only when overflow is scroll", async () => {
    const spy = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = spy;
    try {
      await page.viewport(320, 400);
      const { toggles } = await render(
        <ToggleGroup label="Show" hideLabel overflow="scroll" items={filters} value="all" onValueChange={() => {}} />,
      );
      await pressTab();
      spy.mockClear();
      await act(async () => {
        document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      });
      await expect.poll(() => document.activeElement).toBe(toggles[1]);
      expect(spy).toHaveBeenCalledWith({ inline: "nearest", block: "nearest" });
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  it("does not ask the browser to scroll on arrow navigation when overflow is wrap", async () => {
    const spy = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = spy;
    try {
      await page.viewport(320, 400);
      const { toggles } = await render(
        <ToggleGroup label="Show" hideLabel items={filters} value="all" onValueChange={() => {}} />,
      );
      await pressTab();
      spy.mockClear();
      await act(async () => {
        document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      });
      await expect.poll(() => document.activeElement).toBe(toggles[1]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});
