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

const DEFAULT_PREFS = {
  notifySpoonOnMyRecipe: true,
  notifyForkOfMyRecipe: true,
  notifyCookbookSaveOfMine: true,
  notifyFellowChefOriginCook: true,
};

function renderWithToast(props: Partial<Parameters<typeof NotificationsSection>[0]> = {}) {
  const merged: Parameters<typeof NotificationsSection>[0] = {
    initiallySubscribed: props.initiallySubscribed ?? false,
    initialPreferences: props.initialPreferences ?? DEFAULT_PREFS,
  };
  return render(
    <ToastProvider>
      <NotificationsSection {...merged} />
    </ToastProvider>,
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(DEFAULT_PREFS), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
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

describe("NotificationsSection — preference toggles", () => {
  it("renders four labelled toggles when push is supported", () => {
    (isPushSupported as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ supported: true });
    renderWithToast({ initiallySubscribed: true });
    expect(screen.getByRole("switch", { name: /spoons on my recipes/i })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /forks of my recipes/i })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /saves to cookbooks/i })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /origin cooks by fellow chefs/i })).toBeInTheDocument();
  });

  it("defaults all four toggles to ON when initialPreferences match defaults", () => {
    (isPushSupported as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ supported: true });
    renderWithToast({ initiallySubscribed: true });
    for (const name of [
      /spoons on my recipes/i,
      /forks of my recipes/i,
      /saves to cookbooks/i,
      /origin cooks by fellow chefs/i,
    ]) {
      const sw = screen.getByRole("switch", { name });
      expect(sw.getAttribute("aria-checked")).toBe("true");
    }
  });

  it("renders the toggles in the OFF state when preferences are off", () => {
    (isPushSupported as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ supported: true });
    renderWithToast({
      initiallySubscribed: true,
      initialPreferences: {
        notifySpoonOnMyRecipe: false,
        notifyForkOfMyRecipe: false,
        notifyCookbookSaveOfMine: false,
        notifyFellowChefOriginCook: false,
      },
    });
    for (const name of [
      /spoons on my recipes/i,
      /forks of my recipes/i,
      /saves to cookbooks/i,
      /origin cooks by fellow chefs/i,
    ]) {
      const sw = screen.getByRole("switch", { name });
      expect(sw.getAttribute("aria-checked")).toBe("false");
    }
  });

  it("toggling a switch sends PATCH /api/push/preferences with only the changed key", async () => {
    (isPushSupported as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ supported: true });
    renderWithToast({ initiallySubscribed: true });
    const sw = screen.getByRole("switch", { name: /spoons on my recipes/i });
    fireEvent.click(sw);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/push/preferences");
    expect((init as RequestInit).method).toBe("PATCH");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ notifySpoonOnMyRecipe: false });
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("false"));
  });

  it("toggle failure rolls back the optimistic state and shows an error toast", async () => {
    (isPushSupported as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ supported: true });
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    renderWithToast({ initiallySubscribed: true });
    const sw = screen.getByRole("switch", { name: /forks of my recipes/i });
    fireEvent.click(sw);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Rolled back to ON.
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("true"));
    await waitFor(() =>
      expect(screen.getByText(/unable to update notification preferences/i)).toBeInTheDocument(),
    );
  });

  it("toggle network error rolls back the optimistic state and shows an error toast", async () => {
    (isPushSupported as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ supported: true });
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    renderWithToast({ initiallySubscribed: true });
    const sw = screen.getByRole("switch", { name: /saves to cookbooks/i });
    fireEvent.click(sw);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("true"));
    await waitFor(() =>
      expect(screen.getByText(/unable to update notification preferences/i)).toBeInTheDocument(),
    );
  });

  it("disables all toggles when push is unsupported", () => {
    (isPushSupported as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      supported: false,
      reason: "no_service_worker",
    });
    renderWithToast({ initiallySubscribed: false });
    // Section renders the unsupported message — toggles must NOT render.
    expect(screen.queryByRole("switch", { name: /spoons on my recipes/i })).toBeNull();
  });

  it("disables toggles when the user has no subscription (initiallySubscribed=false)", () => {
    (isPushSupported as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ supported: true });
    renderWithToast({ initiallySubscribed: false });
    for (const name of [
      /spoons on my recipes/i,
      /forks of my recipes/i,
      /saves to cookbooks/i,
      /origin cooks by fellow chefs/i,
    ]) {
      const sw = screen.getByRole("switch", { name });
      expect(sw).toBeDisabled();
    }
  });
});

describe("NotificationsSection — iOS install dialog (B5)", () => {
  it("opens the iOS install dialog when Enable is clicked in iOS non-standalone mode", async () => {
    (isPushSupported as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ supported: true });
    const isIosNonStandalone = (await import("~/lib/push-client")).isIosNonStandalone as unknown as ReturnType<typeof vi.fn>;
    isIosNonStandalone.mockReturnValue(true);

    renderWithToast({ initiallySubscribed: false });
    fireEvent.click(screen.getByRole("button", { name: /enable notifications/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/add spoonjoy to your home screen first/i),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/tap share .* add to home screen/i),
    ).toBeInTheDocument();
    expect(subscribeToPush).not.toHaveBeenCalled();
  });

  it("does NOT open the iOS dialog on non-iOS (subscribe proceeds normally)", async () => {
    (isPushSupported as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ supported: true });
    const isIosNonStandalone = (await import("~/lib/push-client")).isIosNonStandalone as unknown as ReturnType<typeof vi.fn>;
    isIosNonStandalone.mockReturnValue(false);
    (subscribeToPush as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    renderWithToast({ initiallySubscribed: false });
    fireEvent.click(screen.getByRole("button", { name: /enable notifications/i }));
    await waitFor(() => expect(subscribeToPush).toHaveBeenCalled());
    expect(
      screen.queryByText(/add spoonjoy to your home screen first/i),
    ).toBeNull();
  });

  it("Got it button closes the iOS dialog", async () => {
    (isPushSupported as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ supported: true });
    const isIosNonStandalone = (await import("~/lib/push-client")).isIosNonStandalone as unknown as ReturnType<typeof vi.fn>;
    isIosNonStandalone.mockReturnValue(true);

    renderWithToast({ initiallySubscribed: false });
    fireEvent.click(screen.getByRole("button", { name: /enable notifications/i }));
    await waitFor(() =>
      expect(
        screen.getByText(/add spoonjoy to your home screen first/i),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    await waitFor(() =>
      expect(
        screen.queryByText(/add spoonjoy to your home screen first/i),
      ).toBeNull(),
    );
  });
});
