// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { faker } from "@faker-js/faker";

vi.mock("~/lib/analytics-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/analytics-server")>()),
  captureEvent: vi.fn(() => Promise.resolve()),
  captureException: vi.fn(() => Promise.resolve()),
}));

vi.mock("~/lib/webauthn-route.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/webauthn-route.server")>()),
  finishAuthentication: vi.fn(),
}));

import { captureEvent } from "~/lib/analytics-server";
import { createUser } from "~/lib/auth.server";
import { getLocalDb } from "~/lib/db.server";
import { D1WriteUnavailableError } from "~/lib/d1-write-retry.server";
import { finishAuthentication, WebAuthnError } from "~/lib/webauthn-route.server";
import { SIGN_IN_FAILED_EVENT, SIGN_IN_SUCCEEDED_EVENT } from "~/lib/sign-in-outcome.server";
import { action as loginAction } from "~/routes/login";
import { action as passkeyVerify } from "~/routes/auth.webauthn.authenticate.verify";
import { cleanupDatabase } from "../helpers/cleanup";

const RATE_LIMITED = { limit: async () => ({ success: false }) };

function telemetryArgs(request: Request, env: Record<string, unknown> = {}) {
  const waitUntil = vi.fn();
  return { request, params: {}, context: { cloudflare: { env: { POSTHOG_KEY: "ph_test", ...env }, ctx: { waitUntil } } } } as never;
}

function loginRequest(fields: Record<string, string>) {
  return new UndiciRequest("http://localhost:3000/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  }) as unknown as Request;
}

function passkeyRequest(body: unknown) {
  return new UndiciRequest("https://spoonjoy.app/auth/webauthn/authenticate/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as Request;
}

function signInEvents() {
  return vi.mocked(captureEvent).mock.calls
    .map(([, input]) => input)
    .filter((input) => input.event === SIGN_IN_SUCCEEDED_EVENT || input.event === SIGN_IN_FAILED_EVENT)
    .map(({ event, distinctId, properties }) => ({ event, distinctId, properties }));
}

describe("web sign-in outcomes", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;
  let user: { id: string; email: string; username: string };
  const password = "testPassword123";

  beforeEach(async () => {
    vi.mocked(captureEvent).mockClear();
    vi.mocked(finishAuthentication).mockReset();
    await cleanupDatabase();
    db = await getLocalDb();
    user = await createUser(db, faker.internet.email().toLowerCase(), `chef_${faker.string.alphanumeric(10)}`, password);
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("password", () => {
    it("reports a success under the account id", async () => {
      const response = await loginAction(telemetryArgs(loginRequest({ identifier: user.username, password }))) as Response;

      expect(response.status).toBe(302);
      expect(signInEvents()).toEqual([
        {
          event: SIGN_IN_SUCCEEDED_EVENT,
          distinctId: user.id,
          properties: expect.objectContaining({ method: "password", platform: "web", new_account: false }),
        },
      ]);
    });

    it("reports a wrong password under the account the identifier matched, never the identifier", async () => {
      await loginAction(telemetryArgs(loginRequest({ identifier: user.email, password: "wrong-password" })));

      expect(signInEvents()).toEqual([
        {
          event: SIGN_IN_FAILED_EVENT,
          distinctId: user.id,
          properties: expect.objectContaining({ method: "password", platform: "web", failure_reason: "invalid_credentials", account_matched: true }),
        },
      ]);
      expect(JSON.stringify(vi.mocked(captureEvent).mock.calls)).not.toContain(user.email);
    });

    it("reports an unknown identifier anonymously", async () => {
      await loginAction(telemetryArgs(loginRequest({ identifier: "nobody@example.com", password })));

      expect(signInEvents()).toEqual([
        expect.objectContaining({ event: SIGN_IN_FAILED_EVENT, distinctId: "anonymous_web_sign_in" }),
      ]);
    });

    it("reports missing fields and rate limiting", async () => {
      await loginAction(telemetryArgs(loginRequest({ identifier: "", password: "" })));
      await loginAction(telemetryArgs(loginRequest({ identifier: user.username, password }), { AUTH_IP_RATE_LIMITER: RATE_LIMITED }));

      expect(signInEvents().map((event) => event.properties.failure_reason)).toEqual(["missing_fields", "rate_limited"]);
    });

    it("skips the account lookup when telemetry is off", async () => {
      const response = await loginAction({
        request: loginRequest({ identifier: user.username, password: "wrong-password" }),
        params: {},
        context: { cloudflare: { env: null } },
      } as never) as unknown as { init: { status: number } };

      expect(response.init.status).toBe(401);
      expect(signInEvents()).toEqual([]);
    });
  });

  describe("passkey", () => {
    const response = { id: "cred", rawId: "cred", type: "public-key", response: {}, clientExtensionResults: {} };

    it("reports a success under the account id", async () => {
      vi.mocked(finishAuthentication).mockResolvedValue({ userId: user.id, sessionVersion: 0 } as never);

      const res = await passkeyVerify(telemetryArgs(passkeyRequest({ identifier: user.username, response })));

      expect(res.status).toBe(200);
      expect(signInEvents()).toEqual([
        { event: SIGN_IN_SUCCEEDED_EVENT, distinctId: user.id, properties: expect.objectContaining({ method: "passkey", platform: "web" }) },
      ]);
    });

    it("reports a failed verification under the matched account", async () => {
      vi.mocked(finishAuthentication).mockRejectedValue(new WebAuthnError("Passkey verification failed", 401));

      const res = await passkeyVerify(telemetryArgs(passkeyRequest({ email: user.email, response })));

      expect(res.status).toBe(401);
      expect(signInEvents()).toEqual([
        {
          event: SIGN_IN_FAILED_EVENT,
          distinctId: user.id,
          properties: expect.objectContaining({ method: "passkey", failure_reason: "verification_failed", account_matched: true }),
        },
      ]);
    });

    it("reports an unavailable database without looking the account up", async () => {
      vi.mocked(finishAuthentication).mockRejectedValue(new D1WriteUnavailableError("passkey", new Error("D1 down")));

      const res = await passkeyVerify(telemetryArgs(passkeyRequest({ identifier: user.username, response })));

      expect(res.status).toBe(503);
      expect(signInEvents()).toEqual([
        expect.objectContaining({ distinctId: "anonymous_web_sign_in", properties: expect.objectContaining({ failure_reason: "database_unavailable" }) }),
      ]);
    });

    it("reports bad requests and rate limiting", async () => {
      await passkeyVerify(telemetryArgs(passkeyRequest("{not json")));
      await passkeyVerify(telemetryArgs(passkeyRequest({ identifier: user.username })));
      await passkeyVerify(telemetryArgs(passkeyRequest({ identifier: user.username, response }), { AUTH_IP_RATE_LIMITER: RATE_LIMITED }));

      expect(signInEvents().map((event) => event.properties.failure_reason)).toEqual(["invalid_request", "missing_fields", "rate_limited"]);
    });

    it("skips the account lookup when telemetry is off", async () => {
      vi.mocked(finishAuthentication).mockRejectedValue(new WebAuthnError("Passkey verification failed", 401));

      const res = await passkeyVerify({ request: passkeyRequest({ identifier: user.username, response }), params: {}, context: { cloudflare: { env: null } } } as never);

      expect(res.status).toBe(401);
      expect(signInEvents()).toEqual([]);
    });
  });
});
