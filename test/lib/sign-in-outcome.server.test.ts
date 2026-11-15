// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { captureIdentify } from "~/lib/analytics-server";
import { createUser, lookupUserIdByEmailOrUsername } from "~/lib/auth.server";
import { getLocalDb } from "~/lib/db.server";
import {
  nativeInstallDistinctId,
  recordSignInFailed,
  recordSignInSucceeded,
  SIGN_IN_FAILED_EVENT,
  SIGN_IN_SUCCEEDED_EVENT,
} from "~/lib/sign-in-outcome.server";
import { cleanupDatabase } from "../helpers/cleanup";

const INSTALL_ID = "0B1C2D3E-4F50-4617-8293-A4B5C6D7E8F9";

describe("sign-in outcome events", () => {
  it("records a success under the account id with method, platform and version", () => {
    const capture = vi.fn();
    const identify = vi.fn();

    recordSignInSucceeded(capture, { method: "password", platform: "web", userId: "user_1" }, identify);

    expect(capture).toHaveBeenCalledWith(SIGN_IN_SUCCEEDED_EVENT, "user_1", {
      method: "password",
      platform: "web",
      app_version: null,
      install_id: null,
      new_account: false,
    });
    expect(identify).not.toHaveBeenCalled();
  });

  it("links a native install to the account on success", () => {
    const capture = vi.fn();
    const identify = vi.fn();

    recordSignInSucceeded(capture, {
      method: "apple",
      platform: "ios",
      appVersion: "1.2.2",
      installId: INSTALL_ID,
      userId: "user_2",
      newAccount: true,
    }, identify);

    expect(capture).toHaveBeenCalledWith(SIGN_IN_SUCCEEDED_EVENT, "user_2", {
      method: "apple",
      platform: "ios",
      app_version: "1.2.2",
      install_id: INSTALL_ID,
      new_account: true,
    });
    expect(identify).toHaveBeenCalledWith("user_2", nativeInstallDistinctId(INSTALL_ID));
  });

  it("skips the link when no identify sink is given", () => {
    const capture = vi.fn();
    recordSignInSucceeded(capture, { method: "apple", platform: "ios", installId: INSTALL_ID, userId: "user_3" });
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("records a failure under the matched account, else the install, else a shared anonymous id", () => {
    const capture = vi.fn();

    recordSignInFailed(capture, { method: "password", platform: "web", failureReason: "invalid_credentials", matchedUserId: "user_4" });
    recordSignInFailed(capture, { method: "password", platform: "ios", failureReason: "invalid_credentials", installId: INSTALL_ID });
    recordSignInFailed(capture, { method: "passkey", platform: "web", failureReason: "verification_failed" });
    recordSignInFailed(capture, { method: "apple", platform: "native", failureReason: "apple_identity_token_invalid", matchedUserId: null });

    expect(capture.mock.calls).toEqual([
      [SIGN_IN_FAILED_EVENT, "user_4", { method: "password", platform: "web", app_version: null, install_id: null, failure_reason: "invalid_credentials", account_matched: true }],
      [SIGN_IN_FAILED_EVENT, `native_install:${INSTALL_ID}`, { method: "password", platform: "ios", app_version: null, install_id: INSTALL_ID, failure_reason: "invalid_credentials", account_matched: false }],
      [SIGN_IN_FAILED_EVENT, "anonymous_web_sign_in", { method: "passkey", platform: "web", app_version: null, install_id: null, failure_reason: "verification_failed", account_matched: false }],
      [SIGN_IN_FAILED_EVENT, "anonymous_native_app", { method: "apple", platform: "native", app_version: null, install_id: null, failure_reason: "apple_identity_token_invalid", account_matched: false }],
    ]);
  });
});

describe("captureIdentify", () => {
  it("posts a $identify linking the anonymous id to the account", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));

    await captureIdentify(
      { enabled: true, key: "ph_test", host: "https://us.i.posthog.com" },
      { distinctId: "user_1", anonDistinctId: "native_install:abc12345" },
      fetchImpl as unknown as typeof fetch,
      () => new Date("2026-11-15T00:00:00Z"),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://us.i.posthog.com/i/v0/e/");
    expect(JSON.parse(init.body as string)).toEqual({
      api_key: "ph_test",
      event: "$identify",
      distinct_id: "user_1",
      timestamp: "2026-11-15T00:00:00.000Z",
      properties: { $anon_distinct_id: "native_install:abc12345", $lib: "spoonjoy-server" },
    });
  });

  it("does nothing when PostHog is disabled, and uses the global fetch and clock by default", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    await captureIdentify({ enabled: false, reason: "disabled" }, { distinctId: "u", anonDistinctId: "a" });
    expect(fetchSpy).not.toHaveBeenCalled();

    await captureIdentify({ enabled: true, key: "ph_test", host: "https://us.i.posthog.com" }, { distinctId: "u", anonDistinctId: "a" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });
});

describe("lookupUserIdByEmailOrUsername", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("finds an account by email in any case or by exact username, and nothing otherwise", async () => {
    const db = await getLocalDb();
    const email = faker.internet.email().toLowerCase();
    const username = `chef_${faker.string.alphanumeric(10)}`;
    const user = await createUser(db, email, username, "testPassword123");

    await expect(lookupUserIdByEmailOrUsername(db, `  ${email.toUpperCase()} `)).resolves.toBe(user.id);
    await expect(lookupUserIdByEmailOrUsername(db, username)).resolves.toBe(user.id);
    await expect(lookupUserIdByEmailOrUsername(db, username.toUpperCase())).resolves.toBeNull();
    await expect(lookupUserIdByEmailOrUsername(db, "nobody@example.com")).resolves.toBeNull();
    await expect(lookupUserIdByEmailOrUsername(db, "   ")).resolves.toBeNull();
  });
});
