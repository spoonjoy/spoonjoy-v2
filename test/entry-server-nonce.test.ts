import { describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";

/**
 * Guards the CSP-nonce wiring in `handleRequest`. React Router's internal
 * StreamTransfer emits inline hydration scripts (`window.__reactRouterContext…`)
 * that are nonced ONLY via `<ServerRouter nonce>` — NOT via `NonceContext`. So
 * if `handleRequest` forgets to pass the nonce to `ServerRouter`, those scripts
 * render un-nonced and an enforcing CSP blocks them on every page. This test
 * fails if that prop is dropped.
 *
 * We mock `ServerRouter` to capture its props (rendering a real one needs a
 * full `EntryContext`/build, which would make the test brittle). `...actual`
 * keeps the rest of react-router intact for `handleError`'s imports.
 */
const rr = vi.hoisted(() => ({
  serverRouterProps: undefined as Record<string, unknown> | undefined,
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    ServerRouter: (props: Record<string, unknown>) => {
      rr.serverRouterProps = props;
      return null;
    },
  };
});

import handleRequest from "~/entry.server";

function render(nonce: string | undefined) {
  const request = new UndiciRequest("http://localhost/") as unknown as Request;
  // No cloudflare.env → PostHog config resolves disabled, so no analytics I/O.
  const loadContext = { nonce } as never;
  return handleRequest(request, 200, new Headers(), {} as never, loadContext);
}

describe("entry.server handleRequest — CSP nonce wiring", () => {
  it("threads the request nonce into <ServerRouter> so RR streaming scripts are nonced", async () => {
    rr.serverRouterProps = undefined;
    await render("test-nonce-abc123");
    expect(rr.serverRouterProps?.nonce).toBe("test-nonce-abc123");
  });

  it("falls back to an empty nonce when loadContext carries none", async () => {
    rr.serverRouterProps = undefined;
    await render(undefined);
    expect(rr.serverRouterProps?.nonce).toBe("");
  });
});
