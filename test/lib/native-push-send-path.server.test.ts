// The whole native push send path, end to end with only Apple stubbed: a server registers with the
// real relay (workers/push-relay/index.ts) for its key, a notification is enqueued for a cook with a
// registered device, Spoonjoy's relay client posts it to the relay, and the relay signs its provider
// token and calls the stubbed APNs. Live proof against Apple waits on the APNs key (docs/push-relay.md).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalDb } from "~/lib/db.server";
import { enqueueNotification } from "~/lib/notification-dispatch.server";
import type { PostHogServerConfig } from "~/lib/analytics-server";
import { sendNativePush, type NativePushConfig } from "~/lib/native-push.server";
import { sealNativePushToken } from "~/lib/native-push-token.server";
import {
  APNS_HOSTS,
  handle,
  RELAY_URL,
  resetProviderTokenCache,
  type RateLimiter,
  type RelayEnv,
} from "../../workers/push-relay/index";
import { createTestUser } from "../utils";

const VAPID = { publicKey: "BPublic", privateKey: "private", subject: "mailto:test@spoonjoy.app" };
const POSTHOG: PostHogServerConfig = { apiKey: "phc_test", host: "https://us.i.posthog.com" };
const TOKEN = "cd".repeat(32);
const TOKEN_SECRET = "send-path-session-secret";

let p8 = "";
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const b64 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
  p8 = `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
  publicKey = pair.publicKey;
});

const allow: RateLimiter = { limit: async () => ({ success: true }) };

function relayEnv(overrides: Partial<RelayEnv> = {}): RelayEnv {
  return {
    APNS_TOPIC: "app.spoonjoy",
    APNS_TEAM_ID: "TEAM123456",
    APNS_KEY_ID: "KEY1234567",
    APNS_KEY_P8: p8,
    RELAY_KEY_SECRET: "relay-secret-for-the-send-path",
    REVOKED_SERVER_IDS: "",
    REGISTER_LIMITER: allow,
    SEND_KEY_LIMITER: allow,
    SEND_TOKEN_LIMITER: allow,
    ...overrides,
  };
}

/** Apple, stubbed: records each call and answers with `status` (and Apple's reason when refusing). */
function apple(status = 200, reason?: string) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: init?.headers as Record<string, string>, body: String(init?.body) });
    return new Response(reason ? JSON.stringify({ reason }) : null, { status, headers: { "apns-id": "APNS-ID" } });
  });
  return { calls, fetch: fetchImpl as unknown as typeof fetch };
}

/** The relay as Spoonjoy's client reaches it: each request goes to the relay's own handler. */
function relayAt(env: RelayEnv, appleFetch: typeof fetch) {
  const lines: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handle(new Request(input, init), env, { fetch: appleFetch, now: Date.now, log: (line) => lines.push(line) })) as typeof fetch;
  return { fetch: fetchImpl, lines };
}

async function registerServer(relay: { fetch: typeof fetch }): Promise<string> {
  const response = await relay.fetch(`${RELAY_URL}/v1/servers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseUrl: "https://kitchen.example" }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { relayKey: string }).relayKey;
}

async function cookWithPhone() {
  const db = await getLocalDb();
  const [actor, recipient] = await Promise.all([db.user.create({ data: createTestUser() }), db.user.create({ data: createTestUser() })]);
  const where = { userId: recipient.id, deviceId: "phone", platform: "ios", environment: "production" };
  const device = await db.nativePushDevice.create({
    data: { ...where, tokenHash: `hash-${recipient.id}`, tokenPrefix: TOKEN.slice(0, 12), sealedToken: await sealNativePushToken(TOKEN_SECRET, where, TOKEN) },
  });
  return { actor, recipient, device };
}

async function notify(actorId: string, recipientId: string, nativePush: NativePushConfig, relay: { fetch: typeof fetch }) {
  const db = await getLocalDb();
  const tasks: Promise<unknown>[] = [];
  const result = await enqueueNotification(
    db,
    { actorId, recipientId, kind: "spoon_on_my_recipe", payload: { recipeId: "r1", recipeTitle: "Pie", spoonerUsername: "ada" } },
    {
      vapid: VAPID,
      postHogConfig: POSTHOG,
      waitUntil: (task) => tasks.push(task),
      sendPush: vi.fn(),
      nativePush,
      sendNativePush: (config, target, content, options) => sendNativePush(config, target, content, { ...options, fetch: relay.fetch }),
    },
  );
  await Promise.all(tasks);
  return result;
}

function postHogEvents(fetchImpl: typeof fetch): string[] {
  return (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([, init]) => (JSON.parse((init as RequestInit).body as string) as { event: string }).event);
}

describe("native push, end to end through the relay with Apple stubbed", () => {
  let origFetch: typeof globalThis.fetch;
  let postHog: typeof fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    postHog = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    globalThis.fetch = postHog;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
    resetProviderTokenCache();
  });

  it("delivers a notification to the cook's phone through Apple, signed by the relay", async () => {
    const db = await getLocalDb();
    const apns = apple();
    const env = relayEnv();
    const relay = relayAt(env, apns.fetch);
    const relayKey = await registerServer(relay);
    const { actor, recipient } = await cookWithPhone();

    const { eventId } = await notify(actor.id, recipient.id, { relayUrl: RELAY_URL, relayKey, tokenSecret: TOKEN_SECRET }, relay);

    expect(apns.calls).toHaveLength(1);
    const [call] = apns.calls;
    expect(call.url).toBe(`${APNS_HOSTS.production}/3/device/${TOKEN}`);
    expect(call.headers).toMatchObject({ "apns-topic": "app.spoonjoy", "apns-push-type": "alert", "apns-priority": "10", "apns-collapse-id": eventId });
    const jwt = call.headers.authorization.replace(/^bearer /, "");
    const [header, claims, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY1234567" });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toMatchObject({ iss: "TEAM123456" });
    await expect(
      crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, Buffer.from(signature, "base64url"), new TextEncoder().encode(`${header}.${claims}`)),
    ).resolves.toBe(true);
    const payload = JSON.parse(call.body) as { aps: { alert: { title: string; body: string } }; url: string };
    expect(payload.aps.alert.body).toContain("ada");
    expect(payload.url).toContain("r1");
    await expect(db.notificationEvent.findUniqueOrThrow({ where: { id: eventId } })).resolves.toMatchObject({ pushDeliveredAt: expect.any(Date) });
    expect(relay.lines.map((line) => JSON.parse(line).event)).toEqual(["server-registered", "sent"]);
    expect(relay.lines.join("\n")).not.toContain(TOKEN);
    expect(postHogEvents(postHog)).not.toContain("spoonjoy.push.native_send_failed");
  });

  it("revokes the device when Apple says its token is dead", async () => {
    const db = await getLocalDb();
    const relay = relayAt(relayEnv(), apple(410, "Unregistered").fetch);
    const relayKey = await registerServer(relay);
    const { actor, recipient, device } = await cookWithPhone();

    await notify(actor.id, recipient.id, { relayUrl: RELAY_URL, relayKey, tokenSecret: TOKEN_SECRET }, relay);

    await expect(db.nativePushDevice.findUniqueOrThrow({ where: { id: device.id } })).resolves.toMatchObject({ revokedAt: expect.any(String), sealedToken: null });
  });

  it("sends nothing to Apple, and reports no failure, while the relay has no Apple push key", async () => {
    const db = await getLocalDb();
    const apns = apple();
    const relay = relayAt(relayEnv({ APNS_KEY_P8: undefined, APNS_KEY_ID: undefined }), apns.fetch);
    const relayKey = await registerServer(relay);
    const { actor, recipient, device } = await cookWithPhone();

    const { eventId } = await notify(actor.id, recipient.id, { relayUrl: RELAY_URL, relayKey, tokenSecret: TOKEN_SECRET }, relay);

    expect(apns.calls).toHaveLength(0);
    await expect(db.nativePushDevice.findUniqueOrThrow({ where: { id: device.id } })).resolves.toMatchObject({ revokedAt: null, sealedToken: device.sealedToken });
    await expect(db.notificationEvent.findUniqueOrThrow({ where: { id: eventId } })).resolves.toMatchObject({ pushDeliveredAt: null });
    expect(postHogEvents(postHog)).toEqual([]);
  });
});
