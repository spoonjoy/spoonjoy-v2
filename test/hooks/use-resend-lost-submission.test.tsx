import { StrictMode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useActionData } from "react-router";
import { createTestRoutesStub } from "../utils";
import { NETWORK_FAILURE_MESSAGE, NETWORK_RESEND_DELAY_MS } from "~/lib/network-failure";
import { useResendLostSubmission } from "~/hooks/use-resend-lost-submission";

const lost = (resend: Record<string, string> | null) =>
  ({ intent: "updateTitle", error: NETWORK_FAILURE_MESSAGE, errorCode: "network_failure", retryable: true, resend });

function Probe({ result }: { result: unknown }) {
  const actionData = useActionData() ?? result;
  return <p>{useResendLostSubmission(actionData) ? "holding" : "showing"}</p>;
}

function renderProbe(result: unknown, action: (body: string) => unknown, strict = false) {
  const Stub = createTestRoutesStub([
    {
      path: "/",
      Component: () => <Probe result={result} />,
      action: (async ({ request }: { request: Request }) => action(await request.text())) as never,
    },
  ]);
  return render(strict ? <StrictMode><Stub /></StrictMode> : <Stub />);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useResendLostSubmission", () => {
  it("shows a result that is not a lost request at once", async () => {
    renderProbe({ success: true }, vi.fn());
    expect(await screen.findByText("showing")).toBeInTheDocument();
  });

  it("shows a lost request that offers nothing to send again", async () => {
    const action = vi.fn();
    renderProbe(lost(null), action);
    expect(await screen.findByText("showing")).toBeInTheDocument();
    await act(() => new Promise((resolve) => setTimeout(resolve, NETWORK_RESEND_DELAY_MS + 50)));
    expect(action).not.toHaveBeenCalled();
  });

  it("sends the fields once, after a short wait, even when React runs its effects twice", async () => {
    const action = vi.fn(() => ({ success: true }));
    renderProbe(lost({ intent: "updateTitle", title: "Renamed" }), action, true);
    expect(await screen.findByText("holding")).toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
    expect(await screen.findByText("showing")).toBeInTheDocument();
    expect(action.mock.calls).toEqual([["intent=updateTitle&title=Renamed"]]);
  });

  it("sends nothing once the page is gone", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const action = vi.fn();
    const { unmount } = renderProbe(lost({ intent: "updateTitle", title: "Renamed" }), action);
    expect(await screen.findByText("holding")).toBeInTheDocument();
    unmount();
    await vi.advanceTimersByTimeAsync(NETWORK_RESEND_DELAY_MS + 50);
    expect(action).not.toHaveBeenCalled();
  });
});
