// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";

vi.mock("~/lib/analytics-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
  captureEvent: vi.fn(() => Promise.resolve()),
  captureIdentify: vi.fn(() => Promise.resolve()),
}));

vi.mock("~/lib/apple-native-auth.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/apple-native-auth.server")>()),
  handleNativeAppleSignIn: vi.fn(),
}));

vi.mock("~/lib/native-password-auth.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/native-password-auth.server")>()),
  handleNativePasswordSignIn: vi.fn(),
}));

vi.mock("~/lib/pending-apple-link.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/pending-apple-link.server")>()),
  claimPendingAppleLink: vi.fn(),
}));

import { action } from "~/routes/api.v1.$";
import { claimPendingAppleLink } from "~/lib/pending-apple-link.server";
import { captureEvent, captureIdentify } from "~/lib/analytics-server";
import { handleNativeAppleSignIn, NativeAppleAuthError } from "~/lib/apple-native-auth.server";
import { handleNativePasswordSignIn, NativePasswordAuthError } from "~/lib/native-password-auth.server";
import { createUser } from "~/lib/auth.server";
import { getLocalDb } from "~/lib/db.server";
import { SIGN_IN_FAILED_EVENT, SIGN_IN_SUCCEEDED_EVENT } from "~/lib/sign-in-outcome.server";
import { cleanupDatabase } from "../helpers/cleanup";

const INSTALL_ID = "0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9";
const RATE_LIMITED = { limit: async () => ({ success: false }) };
const tokens = { accessToken: "sj_test", refreshToken: "ort_test", expiresIn: 3600, scope: "account:read" };

function nativeArgs(path: string, body: unknown, options: { env?: Record<string, unknown> | null; waitUntil?: boolean } = {}) {
  const request = new UndiciRequest(`http://localhost/api/v1/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Request-Id": "req_native_sign_in" },
    body: JSON.stringify(body),
  }) as unknown as Request;
  const env = options.env === null ? undefined : { POSTHOG_KEY: "ph_test", APPLE_NATIVE_CLIENT_IDS: "app.spoonjoy", ...options.env };
  const ctx = options.waitUntil === false ? undefined : { waitUntil: vi.fn() };
  return { request, params: { "*": path }, context: { cloudflare: env ? { env, ctx } : undefined } } as never;
}

function signInEvents() {
  return vi.mocked(captureEvent).mock.calls
    .map(([, input]) => input)
    .filter((input) => input.event === SIGN_IN_SUCCEEDED_EVENT || input.event === SIGN_IN_FAILED_EVENT)
    .map(({ event, distinctId, properties }) => ({ event, distinctId, properties }));
}

describe("native sign-in outcomes", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    vi.mocked(captureEvent).mockClear();
    vi.mocked(captureIdentify).mockClear();
    vi.mocked(handleNativeAppleSignIn).mockReset();
    vi.mocked(handleNativePasswordSignIn).mockReset();
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("reports an Apple sign-in that created an account, and links the install to it", async () => {
    vi.mocked(handleNativeAppleSignIn).mockResolvedValue({ action: "user_created", userId: "user_apple", clientId: "client", tokens } as never);

    const response = await action(nativeArgs("auth/apple/native", {
      identityToken: "jwt",
      rawNonce: "nonce",
      platform: "ios",
      appVersion: "1.2.2",
      installId: INSTALL_ID,
    }));

    expect(response.status).toBe(201);
    expect(signInEvents()).toEqual([
      {
        event: SIGN_IN_SUCCEEDED_EVENT,
        distinctId: "user_apple",
        properties: { method: "apple", platform: "ios", app_version: "1.2.2", install_id: INSTALL_ID, new_account: true },
      },
    ]);
    expect(captureIdentify).toHaveBeenCalledWith(expect.anything(), { distinctId: "user_apple", anonDistinctId: `native_install:${INSTALL_ID}` });
  });

  it("reports a rejected Apple credential under the install with Apple's code", async () => {
    vi.mocked(handleNativeAppleSignIn).mockRejectedValue(new NativeAppleAuthError("apple_identity_token_invalid", "Invalid", 401));

    const response = await action(nativeArgs("auth/apple/native", { identityToken: "jwt", rawNonce: "nonce", platform: "macos", installId: INSTALL_ID }));

    expect(response.status).toBe(401);
    expect(signInEvents()).toEqual([
      {
        event: SIGN_IN_FAILED_EVENT,
        distinctId: `native_install:${INSTALL_ID}`,
        properties: expect.objectContaining({ method: "apple", platform: "macos", failure_reason: "apple_identity_token_invalid", account_matched: false }),
      },
    ]);
  });

  it("reports a returning password sign-in from an app that sends no client fields", async () => {
    vi.mocked(handleNativePasswordSignIn).mockResolvedValue({ action: "user_logged_in", userId: "user_pw", clientId: "client", tokens } as never);

    const response = await action(nativeArgs("auth/password/native", { emailOrUsername: "chef", password: "pw" }));

    expect(response.status).toBe(201);
    expect(signInEvents()).toEqual([
      {
        event: SIGN_IN_SUCCEEDED_EVENT,
        distinctId: "user_pw",
        properties: { method: "password", platform: "native", app_version: null, install_id: null, new_account: false },
      },
    ]);
    expect(captureIdentify).not.toHaveBeenCalled();
  });

  it("reports a wrong password under the account it named, without the identifier", async () => {
    const user = await createUser(db, "perry.test@example.com", "perry_test_chef", "testPassword123");
    vi.mocked(handleNativePasswordSignIn).mockRejectedValue(new NativePasswordAuthError("invalid_credentials", "Invalid", 401));

    const response = await action(nativeArgs("auth/password/native", { emailOrUsername: "Perry.Test@example.com", password: "wrong", platform: "ios" }));

    expect(response.status).toBe(401);
    expect(signInEvents()).toEqual([
      {
        event: SIGN_IN_FAILED_EVENT,
        distinctId: user.id,
        properties: expect.objectContaining({ method: "password", platform: "ios", failure_reason: "invalid_credentials", account_matched: true }),
      },
    ]);
    expect(JSON.stringify(vi.mocked(captureEvent).mock.calls)).not.toContain("perry.test@example.com");
  });

  it("reports rate limiting, request validation and unexpected faults once each", async () => {
    await action(nativeArgs("auth/password/native", { emailOrUsername: "chef", password: "pw" }, { env: { AUTH_IP_RATE_LIMITER: RATE_LIMITED } }));
    await action(nativeArgs("auth/apple/native", { identityToken: "jwt", rawNonce: "nonce" }, { env: { AUTH_IP_RATE_LIMITER: RATE_LIMITED } }));
    await action(nativeArgs("auth/apple/native", { identityToken: "jwt" }));
    await action(nativeArgs("auth/password/native", { emailOrUsername: "chef", password: "pw", installId: "bad id" }));
    vi.mocked(handleNativePasswordSignIn).mockRejectedValue(new Error("boom"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const fault = await action(nativeArgs("auth/password/native", { emailOrUsername: "chef", password: "pw" }));
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();

    expect(fault.status).toBe(500);
    expect(signInEvents().map((event) => [event.properties.method, event.properties.failure_reason])).toEqual([
      ["password", "rate_limited"],
      ["apple", "rate_limited"],
      ["apple", "validation_error"],
      ["password", "validation_error"],
      ["password", "unexpected_error"],
    ]);
  });

  it("captures nothing without analytics env and still signs in without waitUntil", async () => {
    vi.mocked(handleNativePasswordSignIn).mockResolvedValue({ action: "user_logged_in", userId: "user_pw", clientId: "client", tokens } as never);

    const withoutEnv = await action(nativeArgs("auth/password/native", { emailOrUsername: "chef", password: "pw" }, { env: null }));
    expect(withoutEnv.status).toBe(201);
    expect(signInEvents()).toEqual([]);

    const withoutWaitUntil = await action(nativeArgs("auth/password/native", { emailOrUsername: "chef", password: "pw", installId: INSTALL_ID }, { waitUntil: false }));
    expect(withoutWaitUntil.status).toBe(201);
    expect(signInEvents()).toHaveLength(1);
    expect(captureIdentify).toHaveBeenCalledTimes(1);
  });

  it("does not turn a fault after a successful sign-in into a failed sign-in", async () => {
    vi.mocked(handleNativePasswordSignIn).mockResolvedValue({ action: "user_logged_in", userId: "user_pw", clientId: "client", tokens } as never);
    vi.mocked(claimPendingAppleLink).mockRejectedValueOnce(new Error("link store down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await action(nativeArgs("auth/password/native", { emailOrUsername: "chef", password: "pw", pendingAppleLinkToken: "pending" }));

    expect(response.status).toBe(500);
    consoleError.mockRestore();
    expect(signInEvents().map((event) => event.event)).toEqual([SIGN_IN_SUCCEEDED_EVENT]);
  });
});
