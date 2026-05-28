import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authenticatePasskey,
  browserSupportsPasskeys,
  registerPasskey,
} from "~/lib/webauthn-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("browserSupportsPasskeys", () => {
  it("returns true when the support check passes", () => {
    expect(browserSupportsPasskeys(() => true)).toBe(true);
  });

  it("returns false when the support check fails", () => {
    expect(browserSupportsPasskeys(() => false)).toBe(false);
  });

  it("returns false when the support check throws", () => {
    expect(
      browserSupportsPasskeys(() => {
        throw new Error("no navigator");
      }),
    ).toBe(false);
  });

  it("falls back to the real support check when no override is given", () => {
    // In the test environment there is no PublicKeyCredential, so the real
    // check returns false — but the important thing is the default seam runs.
    expect(typeof browserSupportsPasskeys()).toBe("boolean");
  });
});

describe("registerPasskey", () => {
  it("completes the registration ceremony end to end", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ challenge: "c" })) // options
      .mockResolvedValueOnce(jsonResponse({ verified: true, credentialId: "id" })); // verify
    const startRegistration = vi.fn().mockResolvedValue({ id: "attestation" });

    const result = await registerPasskey({ fetchImpl, startRegistration });

    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenNthCalledWith(1, "/auth/webauthn/register/options", { method: "POST" });
    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: { challenge: "c" } });
    const verifyCall = fetchImpl.mock.calls[1];
    expect(verifyCall[0]).toBe("/auth/webauthn/register/verify");
    expect(JSON.parse(verifyCall[1].body)).toEqual({ response: { id: "attestation" } });
  });

  it("returns an error when the options request fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ error: "Authentication required" }, 401));
    const result = await registerPasskey({ fetchImpl, startRegistration: vi.fn() });
    expect(result).toEqual({ ok: false, error: "Authentication required" });
  });

  it("returns a generic error when the failed options response has no JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("nope", { status: 500 }));
    const result = await registerPasskey({ fetchImpl, startRegistration: vi.fn() });
    expect(result).toEqual({ ok: false, error: "Request failed (500)" });
  });

  it("returns a status-coded error when the failed response JSON has no error field", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({}, 503));
    const result = await registerPasskey({ fetchImpl, startRegistration: vi.fn() });
    expect(result).toEqual({ ok: false, error: "Request failed (503)" });
  });

  it("returns a friendly error when the user dismisses the prompt", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ challenge: "c" }));
    const startRegistration = vi.fn().mockRejectedValue(
      Object.assign(new Error("cancelled"), { name: "NotAllowedError" }),
    );
    const result = await registerPasskey({ fetchImpl, startRegistration });
    expect(result).toEqual({ ok: false, error: "Passkey prompt was dismissed or timed out." });
  });

  it("surfaces other ceremony errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ challenge: "c" }));
    const startRegistration = vi.fn().mockRejectedValue(new Error("weird failure"));
    const result = await registerPasskey({ fetchImpl, startRegistration });
    expect(result).toEqual({ ok: false, error: "weird failure" });
  });

  it("surfaces non-Error ceremony throws with a default message", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ challenge: "c" }));
    const startRegistration = vi.fn().mockRejectedValue("string failure");
    const result = await registerPasskey({ fetchImpl, startRegistration });
    expect(result).toEqual({ ok: false, error: "Passkey ceremony failed." });
  });

  it("returns an error when verification fails", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ challenge: "c" }))
      .mockResolvedValueOnce(jsonResponse({ error: "bad attestation" }, 400));
    const startRegistration = vi.fn().mockResolvedValue({ id: "a" });
    const result = await registerPasskey({ fetchImpl, startRegistration });
    expect(result).toEqual({ ok: false, error: "bad attestation" });
  });
});

describe("authenticatePasskey", () => {
  it("completes the authentication ceremony and returns redirectTo", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ challenge: "ac" })) // options
      .mockResolvedValueOnce(jsonResponse({ verified: true, redirectTo: "/recipes" })); // verify
    const startAuthentication = vi.fn().mockResolvedValue({ id: "assertion" });

    const result = await authenticatePasskey("chef@example.com", "/recipes", {
      fetchImpl,
      startAuthentication,
    });

    expect(result).toEqual({ ok: true, redirectTo: "/recipes" });
    const optionsCall = fetchImpl.mock.calls[0];
    expect(optionsCall[0]).toBe("/auth/webauthn/authenticate/options");
    expect(JSON.parse(optionsCall[1].body)).toEqual({ email: "chef@example.com" });
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: "ac" } });
    const verifyCall = fetchImpl.mock.calls[1];
    expect(JSON.parse(verifyCall[1].body)).toEqual({
      email: "chef@example.com",
      response: { id: "assertion" },
      redirectTo: "/recipes",
    });
  });

  it("returns an error when options fail", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ error: "Email is required" }, 400));
    const result = await authenticatePasskey("", undefined, { fetchImpl, startAuthentication: vi.fn() });
    expect(result).toEqual({ ok: false, error: "Email is required" });
  });

  it("returns a friendly error on prompt dismissal", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ challenge: "ac" }));
    const startAuthentication = vi.fn().mockRejectedValue(
      Object.assign(new Error("cancel"), { name: "NotAllowedError" }),
    );
    const result = await authenticatePasskey("chef@example.com", undefined, {
      fetchImpl,
      startAuthentication,
    });
    expect(result).toEqual({ ok: false, error: "Passkey prompt was dismissed or timed out." });
  });

  it("returns an error when verification fails", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ challenge: "ac" }))
      .mockResolvedValueOnce(jsonResponse({ error: "Unknown credential" }, 400));
    const startAuthentication = vi.fn().mockResolvedValue({ id: "a" });
    const result = await authenticatePasskey("chef@example.com", undefined, {
      fetchImpl,
      startAuthentication,
    });
    expect(result).toEqual({ ok: false, error: "Unknown credential" });
  });

  it("handles a verify response with no redirectTo", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ challenge: "ac" }))
      .mockResolvedValueOnce(jsonResponse({ verified: true }));
    const startAuthentication = vi.fn().mockResolvedValue({ id: "a" });
    const result = await authenticatePasskey("chef@example.com", undefined, {
      fetchImpl,
      startAuthentication,
    });
    expect(result).toEqual({ ok: true, redirectTo: undefined });
  });
});

// Exercise the DI default seams (global fetch + the real @simplewebauthn/browser
// start functions). The real start functions throw in a non-browser env, which
// the flow catches and surfaces as an error — enough to cover the default branch.
describe("default dependency seams", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registerPasskey uses global fetch + default startRegistration", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ challenge: "c" }));
    const result = await registerPasskey();
    expect(result.ok).toBe(false);
    expect(globalThis.fetch).toHaveBeenCalledWith("/auth/webauthn/register/options", { method: "POST" });
  });

  it("authenticatePasskey uses global fetch + default startAuthentication", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ challenge: "ac" }));
    const result = await authenticatePasskey("chef@example.com", undefined);
    expect(result.ok).toBe(false);
    expect(globalThis.fetch).toHaveBeenCalled();
  });
});
