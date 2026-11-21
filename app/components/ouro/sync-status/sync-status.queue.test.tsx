import { useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { SyncStatus, type QueuedWrite } from "~/components/ouro/sync-status/sync-status";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
const hosts: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return { host, rerender: (next: ReactNode) => act(async () => root.render(next)) };
}

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const host of hosts.splice(0)) host.remove();
  for (const region of document.querySelectorAll("[data-ouro-announcer]")) region.remove();
});

const writes: QueuedWrite[] = [
  { id: "a", label: "Rename trail" },
  { id: "b", label: "Close bridge" },
];

describe("SyncStatus queue", () => {
  it("shows no queue and no count attribute while nothing waits", async () => {
    const { host } = await render(<SyncStatus status="saved" queue={[]} />);
    expect(host.querySelector("ul")).toBeNull();
    expect(host.querySelector("[data-ouro-queued]")).toBeNull();
  });

  it("lists each waiting write as pending, with the count in the line and on the root", async () => {
    const { host } = await render(<SyncStatus status="offline" queue={writes} />);
    expect(host.querySelector('[data-ouro="sync-status"]')!.getAttribute("data-ouro-queued")).toBe("2");
    const items = [...host.querySelectorAll("li")];
    expect(items.map((item) => item.textContent)).toEqual(["Rename trail", "Close bridge"]);
    for (const item of items) expect(item.hasAttribute("data-ouro-pending")).toBe(true);
    await expect.element(page.getByText("2 waiting").first()).toBeVisible();
    expect(host.querySelector("ul")!.getAttribute("aria-label")).toBe("2 waiting");
  });

  it("offers Cancel only with onCancel, named after its write", async () => {
    const { host, rerender } = await render(<SyncStatus status="offline" queue={writes} />);
    expect(host.querySelector('[data-ouro-part="cancel"]')).toBeNull();
    const onCancel = vi.fn();
    await rerender(<SyncStatus status="offline" queue={writes} onCancel={onCancel} />);
    const cancel = host.querySelectorAll<HTMLButtonElement>('[data-ouro-part="cancel"]');
    expect(cancel).toHaveLength(2);
    expect(cancel[1]!.getAttribute("data-ouro-control")).toBe("sync-status");
    await expect.element(page.getByRole("button", { name: "Cancel Close bridge" })).toBeVisible();
    await userEvent.click(cancel[0]!);
    expect(onCancel).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("takes the words for the count and Cancel", async () => {
    const { host } = await render(<SyncStatus status="offline" queue={writes} onCancel={() => {}} labels={{ waiting: "{count} en attente", cancel: "Annuler" }} />);
    expect(host.textContent).toContain("2 en attente");
    expect(host.querySelector('[data-ouro-part="cancel"]')!.textContent).toBe("Annuler Rename trail");
  });

  it("moves focus to the status line when the app empties the queue while a Cancel has focus", async () => {
    const onCancel = vi.fn();
    const { host, rerender } = await render(<SyncStatus status="saving" queue={writes} onCancel={onCancel} />);
    host.querySelector<HTMLButtonElement>('[data-ouro-part="cancel"]')!.focus();
    await rerender(<SyncStatus status="saved" queue={[]} onCancel={onCancel} />);
    expect(document.activeElement).toBe(host.querySelector('[data-ouro="sync-status"] > p:not([aria-hidden])'));
  });

  it("leaves focus where it is when the list goes, and while it stays", async () => {
    const onCancel = vi.fn();
    const { host, rerender } = await render(
      <>
        <SyncStatus status="saving" queue={writes} onCancel={onCancel} />
        <button type="button" data-test-harness id="elsewhere">Elsewhere</button>
      </>,
    );
    const cancel = host.querySelector<HTMLButtonElement>('[data-ouro-part="cancel"]')!;
    cancel.focus();
    await rerender(
      <>
        <SyncStatus status="offline" queue={writes} onCancel={onCancel} />
        <button type="button" data-test-harness id="elsewhere">Elsewhere</button>
      </>,
    );
    expect(document.activeElement).toBe(cancel);
    const elsewhere = host.querySelector<HTMLButtonElement>("#elsewhere")!;
    elsewhere.focus();
    await rerender(
      <>
        <SyncStatus status="saved" queue={[]} onCancel={onCancel} />
        <button type="button" data-test-harness id="elsewhere">Elsewhere</button>
      </>,
    );
    expect(document.activeElement).toBe(elsewhere);
  });

  it("takes no focus on mount, and a later list that never held focus takes none from the page", async () => {
    const onCancel = vi.fn();
    const { host, rerender } = await render(
      <>
        <SyncStatus status="saved" onCancel={onCancel} />
        <button type="button" data-test-harness id="elsewhere">Elsewhere</button>
      </>,
    );
    expect(document.activeElement).toBe(document.body);
    const cancel = () => host.querySelector<HTMLButtonElement>('[data-ouro-part="cancel"]');
    const tree = (queue: QueuedWrite[]) => (
      <>
        <SyncStatus status="saving" queue={queue} onCancel={onCancel} />
        <button type="button" data-test-harness id="elsewhere">Elsewhere</button>
      </>
    );
    await rerender(tree([...writes]));
    cancel()!.focus();
    await rerender(tree([]));
    expect(document.activeElement).toBe(host.querySelector('[data-ouro="sync-status"] > p:not([aria-hidden])'));
    await rerender(tree([...writes]));
    const elsewhere = host.querySelector<HTMLButtonElement>("#elsewhere")!;
    elsewhere.focus();
    await rerender(tree([]));
    expect(document.activeElement).toBe(elsewhere);
  });

  it("hands focus to the next write's Cancel when a middle one is cancelled, and to the line after the last", async () => {
    function Queue() {
      const [queue, setQueue] = useState<QueuedWrite[]>([...writes]);
      return <SyncStatus status="offline" queue={queue} onCancel={(id) => setQueue((current) => current.filter((write) => write.id !== id))} />;
    }
    const { host } = await render(<Queue />);
    const first = host.querySelector<HTMLButtonElement>('[data-ouro-part="cancel"]')!;
    first.focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => host.querySelectorAll("li").length).toBe(1);
    await expect.poll(() => document.activeElement).toBe(host.querySelector('[data-ouro-part="cancel"]'));
    (document.activeElement as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => host.querySelector("ul")).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('[data-ouro="sync-status"] > p:not([aria-hidden])'));
  });
});
