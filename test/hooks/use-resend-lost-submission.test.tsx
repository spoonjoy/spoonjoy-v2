import { StrictMode, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Form, Link, useActionData } from "react-router";
import { createTestRoutesStub } from "../utils";
import { NETWORK_FAILURE_MESSAGE, NETWORK_RESEND_DELAY_MS } from "~/lib/network-failure";
import { useResendLostSubmission } from "~/hooks/use-resend-lost-submission";

const lost = (resend: Record<string, string> | null) =>
  ({ intent: "updateTitle", error: NETWORK_FAILURE_MESSAGE, errorCode: "network_failure", retryable: true, resend });

function Probe({ result }: { result: unknown }) {
  const actionData = useActionData() ?? result;
  const [renders, setRenders] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setRenders(renders + 1)}>Render again</button>
      <p>{useResendLostSubmission(actionData) ? "holding" : "showing"}</p>
      <Link to="/other">Elsewhere</Link>
      <Form method="post">
        <input type="hidden" name="intent" value="fresh" />
        <button type="submit">Save again</button>
      </Form>
    </>
  );
}

function renderProbe(
  result: unknown,
  action: (body: string) => unknown,
  { strict = false, otherLoader = () => null }: { strict?: boolean; otherLoader?: () => unknown } = {},
) {
  const Stub = createTestRoutesStub([
    {
      path: "/",
      Component: () => <Probe result={result} />,
      action: (async ({ request }: { request: Request }) => action(await request.text())) as never,
    },
    { path: "/other", Component: () => <p>Other page</p>, loader: otherLoader as never },
  ]);
  return render(strict ? <StrictMode><Stub /></StrictMode> : <Stub />);
}

const never = () => new Promise(() => {});

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
    renderProbe(lost({ intent: "updateTitle", title: "Renamed" }), action, { strict: true });
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

  it("shows the second loss, and keeps showing it on later renders", async () => {
    const action = vi.fn(() => lost({ intent: "updateTitle", title: "Renamed" }));
    renderProbe(lost({ intent: "updateTitle", title: "Renamed" }), action);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("showing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Render again" }));
    expect(screen.getByText("showing")).toBeInTheDocument();
    await act(() => new Promise((resolve) => setTimeout(resolve, NETWORK_RESEND_DELAY_MS + 100)));
    expect(screen.getByText("showing")).toBeInTheDocument();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("cancels the resend when a navigation starts during the wait", async () => {
    const action = vi.fn();
    renderProbe(lost({ intent: "updateTitle", title: "Renamed" }), action, { otherLoader: never });
    expect(await screen.findByText("holding")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Elsewhere" }));
    await act(() => new Promise((resolve) => setTimeout(resolve, NETWORK_RESEND_DELAY_MS + 100)));
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByText("showing")).toBeInTheDocument();
  });

  it("cancels the resend when a new Save starts during the wait", async () => {
    let answer: (value: unknown) => void = () => {};
    const action = vi.fn(() => new Promise((resolve) => { answer = resolve; }));
    renderProbe(lost({ intent: "updateTitle", title: "Renamed" }), action);
    expect(await screen.findByText("holding")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save again" }));
    await act(() => new Promise((resolve) => setTimeout(resolve, NETWORK_RESEND_DELAY_MS + 100)));
    expect(action.mock.calls).toEqual([["intent=fresh"]]);
    await act(async () => answer({ success: true }));
    expect(action).toHaveBeenCalledTimes(1);
  });
});
