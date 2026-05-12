import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToastProvider } from "~/components/ui/toast";
import { NotificationsSection } from "~/components/notifications-section";

vi.mock("~/lib/push-client", () => ({
  isPushSupported: vi.fn(),
  isIosNonStandalone: vi.fn(() => false),
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: vi.fn(),
}));

import {
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "~/lib/push-client";

function renderWithToast(props: Parameters<typeof NotificationsSection>[0]) {
  return render(
    <ToastProvider>
      <NotificationsSection {...props} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("NotificationsSection", () => {
  it("renders 'Enable notifications' button when supported and not yet subscribed", () => {
    (isPushSupported as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ supported: true });
    renderWithToast({ initiallySubscribed: false });
    expect(screen.getByRole("button", { name: /enable notifications/i })).toBeInTheDocument();
  });

  it("renders 'Notifications enabled' label + Disable button when initiallySubscribed", () => {
    (isPushSupported as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ supported: true });
    renderWithToast({ initiallySubscribed: true });
    expect(screen.getByText(/notifications enabled/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /disable/i })).toBeInTheDocument();
  });

  it("renders 'Not supported on this browser' with the reason when push is unsupported", () => {
    (isPushSupported as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      supported: false,
      reason: "no_service_worker",
    });
    renderWithToast({ initiallySubscribed: false });
    expect(screen.getByText(/not supported/i)).toBeInTheDocument();
    expect(screen.getByText(/no_service_worker/)).toBeInTheDocument();
  });

  it("clicking Enable calls subscribeToPush and shows a success toast on ok:true", async () => {
    (isPushSupported as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ supported: true });
    (subscribeToPush as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    renderWithToast({ initiallySubscribed: false });

    fireEvent.click(screen.getByRole("button", { name: /enable notifications/i }));
    await waitFor(() => expect(subscribeToPush).toHaveBeenCalled());
    // After success, the Disable button is rendered (and the success toast text is shown).
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /disable/i })).toBeInTheDocument(),
    );
  });

  it("clicking Enable on failure shows an error toast and stays unsubscribed", async () => {
    (isPushSupported as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ supported: true });
    (subscribeToPush as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      reason: "permission_denied",
    });
    renderWithToast({ initiallySubscribed: false });
    fireEvent.click(screen.getByRole("button", { name: /enable notifications/i }));
    await waitFor(() =>
      expect(screen.getByText(/permission was denied|unable to enable/i)).toBeInTheDocument(),
    );
  });

  it("clicking Disable calls unsubscribeFromPush and reverts to Enable state on ok:true", async () => {
    (isPushSupported as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ supported: true });
    (unsubscribeFromPush as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    renderWithToast({ initiallySubscribed: true });

    fireEvent.click(screen.getByRole("button", { name: /disable/i }));
    await waitFor(() => expect(unsubscribeFromPush).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /enable notifications/i }),
      ).toBeInTheDocument(),
    );
  });

  it("falls back to the generic 'Unable to enable notifications' copy when reason is unknown", async () => {
    (isPushSupported as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ supported: true });
    (subscribeToPush as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      reason: "weird_new_reason_not_in_table",
    });
    renderWithToast({ initiallySubscribed: false });
    fireEvent.click(screen.getByRole("button", { name: /enable notifications/i }));
    await waitFor(() =>
      expect(screen.getByText(/unable to enable notifications/i)).toBeInTheDocument(),
    );
  });

  it("clicking Disable on server error keeps the user marked as enabled and surfaces an error toast", async () => {
    (isPushSupported as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ supported: true });
    (unsubscribeFromPush as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      reason: "server_error",
    });
    renderWithToast({ initiallySubscribed: true });
    fireEvent.click(screen.getByRole("button", { name: /disable/i }));
    await waitFor(() =>
      expect(screen.getByText(/unable to disable/i)).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /disable/i }),
    ).toBeInTheDocument();
  });
});
