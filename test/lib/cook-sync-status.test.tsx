import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SyncStatus } from "~/components/ouro/sync-status/sync-status";
import type { CookSyncStatus } from "~/lib/cook-session-sync";
import { COOK_SYNC_STATUS_TEXT, cookSyncStatusProps } from "~/lib/cook-sync-status";

function shownLine(): HTMLElement {
  return screen.getByTestId("status").querySelector<HTMLElement>("p:not([aria-hidden])")!;
}

describe("cookSyncStatusProps", () => {
  it.each(Object.entries(COOK_SYNC_STATUS_TEXT) as Array<[CookSyncStatus, string]>)("says the %s status in Spoonjoy's words", (status, text) => {
    render(<SyncStatus data-testid="status" {...cookSyncStatusProps(status)} />);
    expect(shownLine()).toHaveTextContent(text);
  });

  it("maps each sync status onto HX's states", () => {
    expect(
      (Object.keys(COOK_SYNC_STATUS_TEXT) as CookSyncStatus[]).map((status) => cookSyncStatusProps(status).status),
    ).toEqual(["saving", "saved", "offline", "offline", "error", "error", "error"]);
  });

  it("reserves the longest problem's words while no problem shows", () => {
    expect(cookSyncStatusProps("synced").labels?.error).toBe(COOK_SYNC_STATUS_TEXT.account_changed);
  });

  it("offers Reload only when another account owns the session or the page is out of date", () => {
    const reload = vi.fn();
    for (const status of ["syncing", "synced", "offline", "stopped", "signed_out"] as const) {
      expect(cookSyncStatusProps(status, reload).onRetry).toBeUndefined();
    }
    const { rerender } = render(<SyncStatus data-testid="status" {...cookSyncStatusProps("account_changed", reload)} />);
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    rerender(<SyncStatus data-testid="status" {...cookSyncStatusProps("update_required", reload)} />);
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("reloads the page by default", () => {
    const reload = vi.fn();
    const location = vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload } as Location);
    cookSyncStatusProps("account_changed").onRetry?.();
    expect(reload).toHaveBeenCalledTimes(1);
    location.mockRestore();
  });
});
