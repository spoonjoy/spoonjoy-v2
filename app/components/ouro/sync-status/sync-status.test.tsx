import { useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { SyncStatus, type SyncState, type SyncStatusProps } from "~/components/ouro/sync-status/sync-status";
import { act } from "~/lib/ouro/testing/act";
import { watchAnnouncements } from "~/lib/ouro/testing/announcements";
import { pressTab } from "~/lib/ouro/testing/tab";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    root,
    rerender: (next: ReactNode) => act(async () => root.render(next)),
    get status() {
      return host.querySelector<HTMLElement>('[data-ouro="sync-status"]')!;
    },
    /** The line people see; the others only hold the height of the longest state. */
    get line() {
      return host.querySelector<HTMLElement>('[data-ouro="sync-status"] > p:not([aria-hidden])')!;
    },
    get retry() {
      return host.querySelector<HTMLButtonElement>('[data-ouro-control="sync-status"]');
    },
  };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

describe("SyncStatus", () => {
  it.each([
    ["saved", "Saved"],
    ["saving", "Saving…"],
    ["offline", "Offline: changes are kept on this device"],
    ["error", "Couldn't save"],
  ] as const)("says %s with its icon", async (state, words) => {
    const { status, line } = await render(<SyncStatus status={state} />);
    expect(status.getAttribute("data-status")).toBe(state);
    expect(line.textContent).toBe(words);
    expect(line.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    await expect.element(page.getByText(words, { exact: true }).last()).toBeVisible();
  });

  it("turns its icon while saving, unless the reader prefers less motion", async () => {
    const { line } = await render(<SyncStatus status="saving" />);
    const icon = line.querySelector("svg")!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    expect(getComputedStyle(icon).animationName).toBe(reduced ? "none" : "ouro-spin");
  });

  it("colors a problem apart from the quiet states", async () => {
    const { line, rerender } = await render(<SyncStatus status="saved" />);
    const quiet = getComputedStyle(line).color;
    await rerender(<SyncStatus status="offline" />);
    const offline = getComputedStyle(line).color;
    await rerender(<SyncStatus status="error" />);
    const error = getComputedStyle(line).color;
    expect(new Set([quiet, offline, error]).size).toBe(3);
  });

  it("keeps one height whichever state it shows, so the page never moves", async () => {
    const { status, rerender } = await render(
      <div style={{ width: 160 }}>
        <SyncStatus status="saved" onRetry={() => {}} />
      </div>,
    );
    const heights = [status.getBoundingClientRect().height];
    for (const state of ["saving", "offline", "error"] as const) {
      await rerender(
        <div style={{ width: 160 }}>
          <SyncStatus status={state} onRetry={() => {}} />
        </div>,
      );
      heights.push(status.getBoundingClientRect().height);
    }
    expect(new Set(heights).size).toBe(1);
    expect(heights[0]).toBeGreaterThan(20);
  });

  it("speaks when a problem starts and when changes are saved again, and not for every save", async () => {
    const announced = watchAnnouncements();
    try {
      const { rerender } = await render(<SyncStatus status="saved" />);
      await rerender(<SyncStatus status="saving" />);
      await rerender(<SyncStatus status="saved" />);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(announced.count("Saved")).toBe(0);
      expect(announced.count("Saving…")).toBe(0);
      await rerender(<SyncStatus status="offline" />);
      await expect.poll(() => announced.count("Offline: changes are kept on this device")).toBe(1);
      await rerender(<SyncStatus status="saving" />);
      await rerender(<SyncStatus status="saved" />);
      await expect.poll(() => announced.count("Saved")).toBe(1);
      await rerender(<SyncStatus status="error" />);
      await expect.poll(() => announced.count("Couldn't save")).toBe(1);
    } finally {
      announced.stop();
    }
  });

  it("does not speak again when only the words change", async () => {
    const announced = watchAnnouncements();
    try {
      const { rerender } = await render(<SyncStatus status="offline" labels={{ offline: "Offline" }} />);
      await expect.poll(() => announced.count("Offline")).toBe(1);
      await rerender(<SyncStatus status="offline" labels={{ offline: "Hors ligne" }} />);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(announced.count("Hors ligne")).toBe(0);
    } finally {
      announced.stop();
    }
  });

  it("shows Retry only while there is a problem, and calls onRetry", async () => {
    const onRetry = vi.fn();
    const { retry, rerender, host } = await render(<SyncStatus status="saved" onRetry={onRetry} />);
    expect(retry).toBeNull();
    await rerender(<SyncStatus status="error" onRetry={onRetry} />);
    const button = host.querySelector<HTMLButtonElement>('[data-ouro-control="sync-status"]')!;
    expect(button.getAttribute("data-ouro-part")).toBe("retry");
    expect(button.getAttribute("type")).toBe("button");
    await expect.element(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await userEvent.click(button);
    expect(onRetry).toHaveBeenCalledOnce();
    await rerender(<SyncStatus status="offline" onRetry={onRetry} />);
    expect(host.querySelector('[data-ouro-control="sync-status"]')).not.toBeNull();
  });

  it("has no Retry without onRetry", async () => {
    const { retry } = await render(<SyncStatus status="error" />);
    expect(retry).toBeNull();
  });

  it("reaches Retry from the keyboard and shows a focus ring", async () => {
    const onRetry = vi.fn();
    const { host } = await render(<SyncStatus status="offline" onRetry={onRetry} />);
    const button = host.querySelector<HTMLButtonElement>('[data-ouro-control="sync-status"]')!;
    document.body.focus();
    await pressTab();
    expect(document.activeElement).toBe(button);
    expect(button.matches(":focus-visible")).toBe(true);
    expect(getComputedStyle(button).outlineStyle).toBe("solid");
    await userEvent.keyboard("{Enter}");
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("keeps focus on the status line when Retry, pressed from the keyboard, goes away", async () => {
    function Editor() {
      const [status, setStatus] = useState<SyncState>("error");
      return (
        <>
          <SyncStatus status={status} onRetry={() => setStatus("saving")} />
          <button type="button" data-test-harness onClick={() => setStatus("saved")}>
            Finish
          </button>
        </>
      );
    }
    const { host, line } = await render(<Editor />);
    const button = host.querySelector<HTMLButtonElement>('[data-ouro-control="sync-status"]')!;
    document.body.focus();
    await pressTab();
    expect(document.activeElement).toBe(button);
    await userEvent.keyboard("{Enter}");
    expect(host.querySelector('[data-ouro-control="sync-status"]')).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(line);
    expect(line.tabIndex).toBe(-1);
    await act(async () => host.querySelector<HTMLButtonElement>("[data-test-harness]")!.click());
    expect(line.textContent).toBe("Saved");
    await act(async () => line.focus());
    expect(document.activeElement).toBe(line);
    await pressTab();
    expect(document.activeElement).toBe(host.querySelector("[data-test-harness]"));
  });

  it("leaves focus alone when Retry goes away without focus", async () => {
    const { host, rerender } = await render(
      <>
        <SyncStatus status="error" onRetry={() => {}} />
        <input aria-label="Notes" data-test-harness />
      </>,
    );
    const input = host.querySelector("input")!;
    input.focus();
    await rerender(
      <>
        <SyncStatus status="saving" onRetry={() => {}} />
        <input aria-label="Notes" data-test-harness />
      </>,
    );
    expect(document.activeElement).toBe(input);
  });

  it("does not move focus when it unmounts with Retry focused", async () => {
    const { host, root } = await render(<SyncStatus status="error" onRetry={() => {}} />);
    host.querySelector<HTMLButtonElement>('[data-ouro-control="sync-status"]')!.focus();
    await act(async () => root.render(null));
    expect(host.innerHTML).toBe("");
    expect(document.activeElement).toBe(document.body);
  });

  it("takes words in another language, and keeps the defaults for the rest", async () => {
    const { line, host } = await render(<SyncStatus status="error" labels={{ error: "Échec", retry: "Réessayer", saved: undefined }} onRetry={() => {}} />);
    expect(line.textContent).toBe("ÉchecRéessayer");
    expect(host.textContent).toContain("Saved");
  });

  it("forwards a ref and div attributes, and lets app layout classes win", async () => {
    let element: HTMLDivElement | null = null;
    const { status } = await render(<SyncStatus status="saved" id="sync" className="mt-4" ref={(node) => void (element = node)} />);
    expect(element).toBe(status);
    expect(status.id).toBe("sync");
    expect(getComputedStyle(status).marginTop).toBe("16px");
  });
});

describe("SyncStatus development messages", () => {
  it.each([
    ["status", { status: "pending" }, 'status="pending" is not a status; use "saved", "saving", "offline" or "error"', '<SyncStatus status="saving" />'],
    ["state", { status: "saved", state: "offline" }, "state is not a prop", '<SyncStatus status="offline" />'],
    ["state", { status: "saved", state: true }, "state is not a prop", '<SyncStatus status="saving" />'],
    ["online", { status: "saved", online: false }, "online is not a prop", '<SyncStatus status="offline" />'],
  ])("explains %s with the fix", async (_name, props, problem, fix) => {
    const { status } = await render(<SyncStatus {...(props as unknown as SyncStatusProps)} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] SyncStatus: ${problem}. Fix: ${fix}.`);
    expect(status.hasAttribute("state")).toBe(false);
    expect(status.hasAttribute("online")).toBe(false);
  });

  it("shows Saved for an unknown status", async () => {
    const { line } = await render(<SyncStatus {...({ status: "pending" } as unknown as SyncStatusProps)} />);
    expect(line.textContent).toBe("Saved");
  });

  it.each([
    ["text-red-500", 'remove "text-red-500"; SyncStatus takes its colors from the theme'],
    ["mt-2", ""],
  ])("checks the className %s", async (className, fix) => {
    await render(<SyncStatus status="saved" className={className} />);
    if (fix) expect(warn).toHaveBeenCalledWith(`[ouro-ui] SyncStatus: "${className}" sets appearance, and className is for layout only. Fix: ${fix}.`);
    else expect(warn).not.toHaveBeenCalled();
  });

  it("renders to a string", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(<SyncStatus status="offline" onRetry={() => {}} />);
    expect(html).toContain('data-status="offline"');
    expect(html).toContain("Retry");
    expect(error).not.toHaveBeenCalled();
  });
});
