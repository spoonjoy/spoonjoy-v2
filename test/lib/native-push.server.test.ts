// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PUSH_RELAY_URL,
  getNativePushConfig,
  nativePushPayload,
  NATIVE_PUSH_TIMEOUT_MS,
  sendNativePush,
  type NativePushConfig,
} from "~/lib/native-push.server";
import { nativePushTokenSecret } from "~/lib/native-push-token.server";

const CONFIG: NativePushConfig = { relayUrl: "https://relay.example", relayKey: "sjr1.id.sig", tokenSecret: "secret" };
const TARGET = { token: "ab".repeat(32), environment: "production" };
const CONTENT = { title: "New spoon", body: "@ada cooked your soup", url: "/recipes/r1" };

function relay(status: number, body: unknown) {
  return vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("getNativePushConfig", () => {
  it("is off without a relay key", () => {
    expect(getNativePushConfig(undefined)).toBeNull();
    expect(getNativePushConfig(null)).toBeNull();
    expect(getNativePushConfig({})).toBeNull();
    expect(getNativePushConfig({ SPOONJOY_PUSH_RELAY_KEY: "  " })).toBeNull();
  });

  it("is off when the relay is turned off, key or not", () => {
    expect(getNativePushConfig({ SPOONJOY_PUSH_RELAY_KEY: "k", SPOONJOY_PUSH_RELAY_URL: "off" })).toBeNull();
    expect(getNativePushConfig({ SPOONJOY_PUSH_RELAY_KEY: "k", SPOONJOY_PUSH_RELAY_URL: "OFF" })).toBeNull();
  });

  it("sends through the relay's address unless told otherwise, under the session secret", () => {
    const env = { SPOONJOY_PUSH_RELAY_KEY: " sjr1.a.b ", SESSION_SECRET: "s".repeat(32) };
    expect(getNativePushConfig(env)).toEqual({
      relayUrl: DEFAULT_PUSH_RELAY_URL,
      relayKey: "sjr1.a.b",
      tokenSecret: nativePushTokenSecret(env),
    });
  });

  it("takes another relay's address, without its trailing slashes", () => {
    expect(getNativePushConfig({ SPOONJOY_PUSH_RELAY_KEY: "k", SPOONJOY_PUSH_RELAY_URL: "https://relay.example//" })?.relayUrl)
      .toBe("https://relay.example");
  });
});

describe("nativePushPayload", () => {
  it("is Apple's alert with a sound, and the page to open", () => {
    expect(nativePushPayload(CONTENT)).toEqual({
      aps: { alert: { title: "New spoon", body: "@ada cooked your soup" }, sound: "default" },
      url: "/recipes/r1",
    });
  });
});

describe("sendNativePush", () => {
  it("posts the token, environment, payload and collapse id to the relay with the server's key", async () => {
    const fetch = relay(200, { status: 200, apnsId: "x" });
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await expect(sendNativePush(CONFIG, TARGET, CONTENT, { collapseId: "event-1", fetch })).resolves.toEqual({
      status: "delivered",
      httpStatus: 200,
      apnsStatus: 200,
    });
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://relay.example/v1/send");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ authorization: "Bearer sjr1.id.sig", "content-type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({
      token: TARGET.token,
      environment: "production",
      payload: nativePushPayload(CONTENT),
      collapseId: "event-1",
    });
    expect(timeout).toHaveBeenCalledWith(NATIVE_PUSH_TIMEOUT_MS);
    timeout.mockRestore();
  });

  it("sends no collapse id when given none, through the global fetch by default", async () => {
    const fetch = relay(200, { status: 200 });
    vi.stubGlobal("fetch", fetch);
    try {
      await sendNativePush(CONFIG, TARGET, CONTENT);
    } finally {
      vi.unstubAllGlobals();
    }
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).not.toHaveProperty("collapseId");
  });

  it("is expired when the relay says to revoke the device", async () => {
    await expect(sendNativePush(CONFIG, TARGET, CONTENT, { fetch: relay(200, { status: 410, reason: "Unregistered", revoke: true }) }))
      .resolves.toEqual({ status: "expired", httpStatus: 200, apnsStatus: 410, reason: "Unregistered" });
  });

  it("is expired when Apple calls the token bad, as for a development token sent as production", async () => {
    await expect(sendNativePush(CONFIG, TARGET, CONTENT, { fetch: relay(200, { status: 400, reason: "BadDeviceToken", revoke: false }) }))
      .resolves.toEqual({ status: "expired", httpStatus: 200, apnsStatus: 400, reason: "BadDeviceToken" });
  });

  it("is expired, asking the relay nothing, for a token that isn't Apple's hex", async () => {
    const fetch = relay(200, { status: 200 });
    await expect(sendNativePush(CONFIG, { ...TARGET, token: "apns-token-from-a-test" }, CONTENT, { fetch }))
      .resolves.toEqual({ status: "expired", httpStatus: 0, reason: "not_an_apple_token" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails, keeping the device, when Apple refuses it for another reason", async () => {
    await expect(sendNativePush(CONFIG, TARGET, CONTENT, { fetch: relay(200, { status: 400, reason: "BadTopic", revoke: false }) }))
      .resolves.toEqual({ status: "failed", httpStatus: 200, apnsStatus: 400, reason: "BadTopic" });
    await expect(sendNativePush(CONFIG, TARGET, CONTENT, { fetch: relay(200, { status: 429, reason: "BadDeviceToken" }) }))
      .resolves.toEqual({ status: "failed", httpStatus: 200, apnsStatus: 429, reason: "BadDeviceToken" });
  });

  it("fails when the relay answers 200 without Apple's status", async () => {
    await expect(sendNativePush(CONFIG, TARGET, CONTENT, { fetch: relay(200, { status: "200", reason: 7 }) }))
      .resolves.toEqual({ status: "failed", httpStatus: 200 });
  });

  it("is unavailable, not failed, while the relay has no Apple push key", async () => {
    await expect(sendNativePush(CONFIG, TARGET, CONTENT, { fetch: relay(503, { error: "not_configured" }) }))
      .resolves.toEqual({ status: "unavailable", httpStatus: 503, reason: "not_configured" });
  });

  it("fails with the relay's error code when the relay refuses", async () => {
    await expect(sendNativePush(CONFIG, TARGET, CONTENT, { fetch: relay(401, { error: "unauthorized" }) }))
      .resolves.toEqual({ status: "failed", httpStatus: 401, reason: "unauthorized" });
    await expect(sendNativePush(CONFIG, TARGET, CONTENT, { fetch: relay(503, { error: "overloaded" }) }))
      .resolves.toEqual({ status: "failed", httpStatus: 503, reason: "overloaded" });
  });

  it("fails with no reason when the relay's refusal isn't its JSON", async () => {
    await expect(sendNativePush(CONFIG, TARGET, CONTENT, { fetch: relay(502, "Bad gateway") }))
      .resolves.toEqual({ status: "failed", httpStatus: 502 });
    await expect(sendNativePush(CONFIG, TARGET, CONTENT, { fetch: relay(500, "null") }))
      .resolves.toEqual({ status: "failed", httpStatus: 500 });
  });

  it("fails with status 0 when the relay doesn't answer", async () => {
    const timedOut = vi.fn(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    }) as unknown as typeof fetch;
    await expect(sendNativePush(CONFIG, TARGET, CONTENT, { fetch: timedOut }))
      .resolves.toEqual({ status: "failed", httpStatus: 0, reason: "The push relay at https://relay.example did not answer (TimeoutError)." });
    const thrown = vi.fn(async () => {
      throw "boom";
    }) as unknown as typeof fetch;
    await expect(sendNativePush(CONFIG, TARGET, CONTENT, { fetch: thrown }))
      .resolves.toEqual({ status: "failed", httpStatus: 0, reason: "The push relay at https://relay.example did not answer (a non-Error throw)." });
  });
});
