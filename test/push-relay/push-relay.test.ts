// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import relay, {
  APNS_HOSTS,
  APNS_TIMEOUT_MS,
  MAX_BASE_URL_LENGTH,
  MAX_PAYLOAD_BYTES,
  PROVIDER_TOKEN_WINDOW_MS,
  handle,
  issueRelayKey,
  providerToken,
  resetProviderTokenCache,
  verifyRelayKey,
  type RateLimiter,
  type RelayDeps,
  type RelayEnv,
} from "../../workers/push-relay/index";

const TOKEN = "ab".repeat(32);
const SECRET = "relay-secret-for-tests";

let p8 = "";
let publicKey: CryptoKey;

function pem(bytes: ArrayBuffer): string {
  const b64 = Buffer.from(bytes).toString("base64");
  return `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  p8 = pem(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  publicKey = pair.publicKey;
});

afterEach(() => {
  resetProviderTokenCache();
  vi.restoreAllMocks();
});

function limiter(allow = true): RateLimiter & { keys: string[] } {
  const keys: string[] = [];
  return {
    keys,
    limit: vi.fn(async ({ key }: { key: string }) => {
      keys.push(key);
      return { success: allow };
    }),
  };
}

function relayEnv(overrides: Partial<RelayEnv> = {}): RelayEnv {
  return {
    APNS_TOPIC: "app.spoonjoy",
    APNS_TEAM_ID: "TEAM123456",
    APNS_KEY_ID: "KEY1234567",
    APNS_KEY_P8: p8,
    RELAY_KEY_SECRET: SECRET,
    REVOKED_SERVER_IDS: "",
    REGISTER_LIMITER: limiter(),
    SEND_KEY_LIMITER: limiter(),
    SEND_TOKEN_LIMITER: limiter(),
    ...overrides,
  };
}

type AppleCall = { url: string; headers: Record<string, string>; body: string; signal: AbortSignal | null | undefined };

function apple(...answers: Array<Response | Error>) {
  const calls: AppleCall[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: init?.headers as Record<string, string>,
      body: String(init?.body),
      signal: init?.signal,
    });
    const answer = answers.shift() ?? new Response(null, { status: 200, headers: { "apns-id": "APNS-ID" } });
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return { calls, fetch: fetchImpl as unknown as typeof fetch };
}

function relayDeps(fetchImpl: typeof fetch, now = 1_800_000_000_000): RelayDeps & { lines: string[] } {
  const lines: string[] = [];
  return { fetch: fetchImpl, now: () => now, log: (line) => lines.push(line), lines };
}

function appleRefusal(status: number, reason: string): Response {
  return new Response(JSON.stringify({ reason }), { status, headers: { "apns-id": "APNS-ID" } });
}

async function relayKey(): Promise<string> {
  return (await issueRelayKey(SECRET)).relayKey;
}

function sendRequest(key: string | null, body: unknown, init: { method?: string; raw?: string } = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key !== null) headers.authorization = `Bearer ${key}`;
  return new Request("https://push.spoonjoy.app/v1/send", {
    method: init.method ?? "POST",
    headers,
    ...(init.method === "GET" ? {} : { body: init.raw ?? JSON.stringify(body) }),
  });
}

const ALERT = { aps: { alert: { title: "Spoonjoy", body: "@ada cooked your soup" } }, url: "/recipes/r1" };

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

describe("the push relay's health", () => {
  it("says whether its Apple key and relay keys are set", async () => {
    const deps = relayDeps(apple().fetch);
    const configured = await handle(new Request("https://push.spoonjoy.app/health"), relayEnv(), deps);
    expect(configured.status).toBe(200);
    expect(configured.headers.get("cache-control")).toBe("no-store");
    expect(await configured.json()).toEqual({ ok: true, service: "spoonjoy-push-relay", apns: "configured", registration: "open" });

    const bare = await handle(
      new Request("https://push.spoonjoy.app/health", { method: "HEAD" }),
      relayEnv({ APNS_KEY_P8: " ", APNS_KEY_ID: undefined, RELAY_KEY_SECRET: undefined }),
      deps,
    );
    expect(bare.status).toBe(200);
    const missingTeam = await handle(new Request("https://push.spoonjoy.app/health"), relayEnv({ APNS_TEAM_ID: "" }), deps);
    expect(await missingTeam.json()).toMatchObject({ apns: "not configured" });
    const unset = await handle(new Request("https://push.spoonjoy.app/health"), relayEnv({ APNS_KEY_P8: undefined, RELAY_KEY_SECRET: undefined }), deps);
    expect(await unset.json()).toEqual({ ok: true, service: "spoonjoy-push-relay", apns: "not configured", registration: "not configured" });
  });

  it("answers 404 elsewhere and 405 to the wrong method", async () => {
    const deps = relayDeps(apple().fetch);
    const missing = await handle(new Request("https://push.spoonjoy.app/"), relayEnv(), deps);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: "not_found" });
    expect((await handle(new Request("https://push.spoonjoy.app/health", { method: "POST" }), relayEnv(), deps)).status).toBe(404);
    expect((await handle(new Request("https://push.spoonjoy.app/v1/servers"), relayEnv(), deps)).status).toBe(405);
    expect((await handle(sendRequest(null, null, { method: "GET" }), relayEnv(), deps)).status).toBe(405);
  });
});

describe("registering a server", () => {
  function registration(body: unknown, ip: string | null = "203.0.113.9", raw?: string): Request {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (ip) headers["cf-connecting-ip"] = ip;
    return new Request("https://push.spoonjoy.app/v1/servers", { method: "POST", headers, body: raw ?? JSON.stringify(body) });
  }

  it("issues a relay key that verifies, and logs only the server's id and origin", async () => {
    const env = relayEnv();
    const deps = relayDeps(apple().fetch);
    const response = await handle(registration({ baseUrl: "https://recipes.example.com/kitchen?x=1" }), env, deps);
    expect(response.status).toBe(201);
    const { serverId, relayKey: key } = (await response.json()) as { serverId: string; relayKey: string };
    expect(key).toMatch(/^sjr1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    expect(await verifyRelayKey(SECRET, key)).toBe(serverId);
    expect((env.REGISTER_LIMITER as ReturnType<typeof limiter>).keys).toEqual(["ip:203.0.113.9"]);
    expect(deps.lines).toEqual([JSON.stringify({ event: "server-registered", serverId, origin: "https://recipes.example.com" })]);
  });

  it("takes a plain http:// address, and counts a request without an address as unknown", async () => {
    const env = relayEnv();
    const response = await handle(registration({ baseUrl: "http://192.168.1.20:8080" }, null), env, relayDeps(apple().fetch));
    expect(response.status).toBe(201);
    expect((env.REGISTER_LIMITER as ReturnType<typeof limiter>).keys).toEqual(["ip:unknown"]);
  });

  it.each([
    ["no body", undefined, "not json"],
    ["an array", [], undefined],
    ["a missing address", {}, undefined],
    ["an address that isn't a URL", { baseUrl: "not a url" }, undefined],
    ["an address on another scheme", { baseUrl: "ftp://example.com" }, undefined],
    ["an address that's too long", { baseUrl: `https://example.com/${"a".repeat(MAX_BASE_URL_LENGTH)}` }, undefined],
    ["a body that's too big", undefined, JSON.stringify({ baseUrl: "https://example.com", pad: "x".repeat(20_000) })],
  ])("refuses %s", async (_label, body, raw) => {
    const response = await handle(registration(body, "203.0.113.9", raw), relayEnv(), relayDeps(apple().fetch));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
  });

  it("is rate limited per address, and closed until RELAY_KEY_SECRET is set", async () => {
    const limited = await handle(registration({ baseUrl: "https://a.example" }), relayEnv({ REGISTER_LIMITER: limiter(false) }), relayDeps(apple().fetch));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: "rate_limited" });

    const closed = await handle(registration({ baseUrl: "https://a.example" }), relayEnv({ RELAY_KEY_SECRET: "  " }), relayDeps(apple().fetch));
    expect(closed.status).toBe(503);
    expect(await closed.json()).toMatchObject({ error: "not_configured" });
  });
});

describe("relay keys", () => {
  it("verify only under the secret that signed them, and only in their own shape", async () => {
    const { serverId, relayKey: key } = await issueRelayKey(SECRET);
    expect(await verifyRelayKey(SECRET, key)).toBe(serverId);
    expect(await verifyRelayKey("another secret", key)).toBeNull();
    const [, id, signature] = key.split(".");
    const otherId = (await issueRelayKey(SECRET)).serverId;
    expect(await verifyRelayKey(SECRET, `sjr1.${otherId}.${signature}`)).toBeNull();
    expect(await verifyRelayKey(SECRET, `sjr2.${id}.${signature}`)).toBeNull();
    expect(await verifyRelayKey(SECRET, `sjr1.${id}`)).toBeNull();
    expect(await verifyRelayKey(SECRET, `sjr1.${id}x.${signature}`)).toBeNull();
    expect(await verifyRelayKey(SECRET, `sjr1.${id}.${signature}x`)).toBeNull();
  });
});

describe("Apple's provider token", () => {
  it("is an ES256 JWT for the team and key, signed with the APNs key, dated to its 30-minute window and reused through it", async () => {
    const env = relayEnv();
    const windowStart = 1_800_000_000_000 - (1_800_000_000_000 % PROVIDER_TOKEN_WINDOW_MS);
    const now = windowStart + 7 * 60_000;
    const token = await providerToken(env, now);
    const [header, claims, signature] = token.split(".");
    expect(decodePart(header)).toEqual({ alg: "ES256", kid: "KEY1234567" });
    expect(decodePart(claims)).toEqual({ iss: "TEAM123456", iat: windowStart / 1000 });
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      Buffer.from(signature, "base64url"),
      new TextEncoder().encode(`${header}.${claims}`),
    );
    expect(valid).toBe(true);

    expect(await providerToken(env, windowStart + PROVIDER_TOKEN_WINDOW_MS - 1)).toBe(token);
    const renewed = await providerToken(env, windowStart + PROVIDER_TOKEN_WINDOW_MS);
    expect(renewed).not.toBe(token);
    expect(decodePart(renewed.split(".")[1]).iat).toBe((windowStart + PROVIDER_TOKEN_WINDOW_MS) / 1000);
    // A new key id, or a new key under the same id, makes a new token at once.
    const rotated = await providerToken({ ...env, APNS_KEY_ID: "KEY7654321" }, windowStart + PROVIDER_TOKEN_WINDOW_MS);
    expect(decodePart(rotated.split(".")[0]).kid).toBe("KEY7654321");
    const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const rekeyed = await providerToken({ ...env, APNS_KEY_ID: "KEY7654321", APNS_KEY_P8: pem(await crypto.subtle.exportKey("pkcs8", other.privateKey)) }, windowStart + PROVIDER_TOKEN_WINDOW_MS);
    expect(rekeyed).not.toBe(rotated);
  });
});

describe("sending a notification", () => {
  it("signs, sends to Apple's production host for the app's topic, and answers with Apple's status", async () => {
    const env = relayEnv();
    const { calls, fetch: fetchImpl } = apple();
    const deps = relayDeps(fetchImpl);
    const key = await relayKey();
    const response = await handle(
      sendRequest(key, { token: TOKEN.toUpperCase(), environment: "production", payload: ALERT, collapseId: "event-1", expiration: 1_800_086_400 }),
      env,
      deps,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 200, reason: null, apnsId: "APNS-ID", revoke: false });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${APNS_HOSTS.production}/3/device/${TOKEN}`);
    expect(calls[0].body).toBe(JSON.stringify(ALERT));
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
    const { authorization, ...headers } = calls[0].headers;
    expect(headers).toEqual({
      "apns-topic": "app.spoonjoy",
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
      "apns-collapse-id": "event-1",
      "apns-expiration": "1800086400",
    });
    expect(authorization).toBe(`bearer ${await providerToken(env, deps.now())}`);
    // The log names the server and Apple's answer, never the token or the payload.
    const serverId = key.split(".")[1];
    expect(deps.lines).toEqual([JSON.stringify({ event: "sent", serverId, environment: "production", status: 200, reason: null })]);
    expect(deps.lines.join("")).not.toContain(TOKEN);
    expect(APNS_TIMEOUT_MS).toBe(10_000);
  });

  it("sends a development token to the sandbox host, and a background push at priority 5", async () => {
    const { calls, fetch: fetchImpl } = apple();
    const response = await handle(
      sendRequest(await relayKey(), { token: TOKEN, environment: "development", payload: { aps: { "content-available": 1 } }, pushType: "background" }),
      relayEnv(),
      relayDeps(fetchImpl),
    );
    expect(response.status).toBe(200);
    expect(calls[0].url).toBe(`${APNS_HOSTS.development}/3/device/${TOKEN}`);
    expect(calls[0].headers).toMatchObject({ "apns-push-type": "background", "apns-priority": "5" });
    expect(calls[0].headers).not.toHaveProperty("apns-collapse-id");
    expect(calls[0].headers).not.toHaveProperty("apns-expiration");
  });

  it.each([
    [410, "Unregistered", true],
    // Apple also says BadDeviceToken for a good token sent to the other environment's host.
    [400, "BadDeviceToken", false],
    [400, "DeviceTokenNotForTopic", true],
    [400, "PayloadTooLarge", false],
    [429, "TooManyRequests", false],
    [500, "InternalServerError", false],
  ])("passes on Apple's %i %s, with revoke %s", async (status, reason, revoke) => {
    const { fetch: fetchImpl } = apple(appleRefusal(status, reason));
    const response = await handle(sendRequest(await relayKey(), { token: TOKEN, environment: "production", payload: ALERT }), relayEnv(), relayDeps(fetchImpl));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status, reason, apnsId: "APNS-ID", revoke });
  });

  it("reads no reason from an answer that isn't Apple's JSON", async () => {
    const odd = [new Response("<html>bad gateway</html>", { status: 502 }), new Response(JSON.stringify({ reason: 7 }), { status: 400 })];
    for (const answer of odd) {
      const response = await handle(sendRequest(await relayKey(), { token: TOKEN, environment: "production", payload: ALERT }), relayEnv(), relayDeps(apple(answer).fetch));
      expect(await response.json()).toMatchObject({ reason: null, apnsId: null, revoke: false });
    }
  });

  it.each([
    [403, "InvalidProviderToken", "provider-token-refused"],
    [403, "ExpiredProviderToken", "provider-token-refused"],
    [429, "TooManyProviderTokenUpdates", "provider-token-refused"],
    [403, "Forbidden", "sent"],
  ])("passes on Apple's %i %s once, without trying again, logged as %s", async (status, reason, event) => {
    const { calls, fetch: fetchImpl } = apple(appleRefusal(status, reason));
    const deps = relayDeps(fetchImpl);
    const response = await handle(sendRequest(await relayKey(), { token: TOKEN, environment: "production", payload: ALERT }), relayEnv(), deps);
    expect(await response.json()).toEqual({ status, reason, apnsId: "APNS-ID", revoke: false });
    expect(calls).toHaveLength(1);
    expect(JSON.parse(deps.lines[0])).toMatchObject({ event, status, reason });
  });

  it("answers 503 misconfigured, without calling Apple, when the Apple key can't be read", async () => {
    const { calls, fetch: fetchImpl } = apple();
    const deps = relayDeps(fetchImpl);
    const response = await handle(
      sendRequest(await relayKey(), { token: TOKEN, environment: "production", payload: ALERT }),
      relayEnv({ APNS_KEY_P8: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----" }),
      deps,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "misconfigured" });
    expect(calls).toHaveLength(0);
    expect(JSON.parse(deps.lines[0])).toMatchObject({ event: "apns-key-unreadable" });

    const odd = relayDeps(apple().fetch);
    const importKey = crypto.subtle.importKey.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "importKey").mockImplementation(((format: string, ...rest: unknown[]) =>
      format === "pkcs8" ? Promise.reject("plain") : (importKey as (...args: unknown[]) => Promise<CryptoKey>)(format, ...rest)) as typeof crypto.subtle.importKey);
    const second = await handle(sendRequest(await relayKey(), { token: TOKEN, environment: "production", payload: ALERT }), relayEnv(), odd);
    expect(second.status).toBe(503);
    expect(JSON.parse(odd.lines[0])).toEqual({ event: "apns-key-unreadable", error: "Error" });
  });

  it("answers 502 when Apple can't be reached, naming only the error's kind", async () => {
    const deps = relayDeps(apple(new TypeError("network down: token abc")).fetch);
    const response = await handle(sendRequest(await relayKey(), { token: TOKEN, environment: "production", payload: ALERT }), relayEnv(), deps);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "apns_unreachable" });
    expect(deps.lines[0]).toContain('"error":"TypeError"');

    const odd = relayDeps((async () => Promise.reject("plain")) as unknown as typeof fetch);
    const second = await handle(sendRequest(await relayKey(), { token: TOKEN, environment: "production", payload: ALERT }), relayEnv(), odd);
    expect(second.status).toBe(502);
    expect(odd.lines[0]).toContain('"error":"Error"');
  });

  it("answers 503 not_configured, after checking the key and the request, until the Apple key is set", async () => {
    const { calls, fetch: fetchImpl } = apple();
    const response = await handle(
      sendRequest(await relayKey(), { token: TOKEN, environment: "production", payload: ALERT }),
      relayEnv({ APNS_KEY_P8: undefined }),
      relayDeps(fetchImpl),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "not_configured" });
    expect(calls).toHaveLength(0);
  });

  it("refuses a missing, malformed, foreign or revoked relay key", async () => {
    const deps = relayDeps(apple().fetch);
    const body = { token: TOKEN, environment: "production", payload: ALERT };
    expect((await handle(sendRequest(null, body), relayEnv(), deps)).status).toBe(401);
    expect((await handle(sendRequest("not-a-key", body), relayEnv(), deps)).status).toBe(401);
    expect((await handle(sendRequest((await issueRelayKey("other")).relayKey, body), relayEnv(), deps)).status).toBe(401);
    expect((await handle(sendRequest(await relayKey(), body), relayEnv({ RELAY_KEY_SECRET: undefined }), deps)).status).toBe(401);

    const { serverId, relayKey: key } = await issueRelayKey(SECRET);
    const revoked = await handle(sendRequest(key, body), relayEnv({ REVOKED_SERVER_IDS: ` other , ${serverId}` }), deps);
    expect(revoked.status).toBe(403);
    expect(await revoked.json()).toMatchObject({ error: "revoked" });
    expect((await handle(sendRequest(key, body), relayEnv({ REVOKED_SERVER_IDS: undefined }), deps)).status).toBe(200);
  });

  it("refuses a body that says it's too big before reading it", async () => {
    const request = new Request("https://push.spoonjoy.app/v1/send", {
      method: "POST",
      headers: { authorization: `Bearer ${await relayKey()}`, "content-length": "20000" },
      body: "{}",
    });
    const text = vi.spyOn(request, "text");
    const response = await handle(request, relayEnv(), relayDeps(apple().fetch));
    expect(response.status).toBe(400);
    expect(text).not.toHaveBeenCalled();
  });

  it("is rate limited per server key and per device token, counting a token by its hash", async () => {
    const body = { token: TOKEN, environment: "production", payload: ALERT };
    const { serverId, relayKey: key } = await issueRelayKey(SECRET);
    const perKey = relayEnv({ SEND_KEY_LIMITER: limiter(false) });
    const keyLimited = await handle(sendRequest(key, body), perKey, relayDeps(apple().fetch));
    expect(keyLimited.status).toBe(429);
    expect((perKey.SEND_KEY_LIMITER as ReturnType<typeof limiter>).keys).toEqual([`server:${serverId}`]);

    const perToken = relayEnv({ SEND_TOKEN_LIMITER: limiter(false) });
    const tokenLimited = await handle(sendRequest(key, { ...body, token: TOKEN.toUpperCase() }), perToken, relayDeps(apple().fetch));
    expect(tokenLimited.status).toBe(429);
    const [tokenKey] = (perToken.SEND_TOKEN_LIMITER as ReturnType<typeof limiter>).keys;
    expect(tokenKey).toMatch(/^token:[0-9a-f]{64}$/);
    expect(tokenKey).not.toContain(TOKEN);
  });

  it.each([
    ["a body that isn't JSON", "raw:{", "The body must be a JSON object."],
    ["a short token", { token: "abc", environment: "production", payload: ALERT }, "token must be the device token in hex."],
    ["a token that isn't text", { token: 7, environment: "production", payload: ALERT }, "token must be the device token in hex."],
    ["another environment", { token: TOKEN, environment: "staging", payload: ALERT }, "environment must be development or production."],
    ["no payload", { token: TOKEN, environment: "production" }, "payload must be an object."],
    ["a payload list", { token: TOKEN, environment: "production", payload: [] }, "payload must be an object."],
    ["a payload without aps", { token: TOKEN, environment: "production", payload: { url: "/" } }, "payload.aps must be an object."],
    ["an aps list", { token: TOKEN, environment: "production", payload: { aps: [] } }, "payload.aps must be an object."],
    [
      "a payload over Apple's limit",
      { token: TOKEN, environment: "production", payload: { aps: { alert: "x".repeat(MAX_PAYLOAD_BYTES) } } },
      `payload must be at most ${MAX_PAYLOAD_BYTES} bytes.`,
    ],
    ["another push type", { token: TOKEN, environment: "production", payload: ALERT, pushType: "voip" }, "pushType must be alert or background."],
    ["an empty collapse id", { token: TOKEN, environment: "production", payload: ALERT, collapseId: "" }, "collapseId must be at most 64 printable ASCII characters."],
    ["a long collapse id", { token: TOKEN, environment: "production", payload: ALERT, collapseId: "c".repeat(65) }, "collapseId must be at most 64 printable ASCII characters."],
    ["a collapse id with a line break", { token: TOKEN, environment: "production", payload: ALERT, collapseId: "a\r\nb" }, "collapseId must be at most 64 printable ASCII characters."],
    ["a collapse id that isn't text", { token: TOKEN, environment: "production", payload: ALERT, collapseId: 3 }, "collapseId must be at most 64 printable ASCII characters."],
    ["a fractional expiration", { token: TOKEN, environment: "production", payload: ALERT, expiration: 1.5 }, "expiration must be a whole number of seconds since 1970."],
    ["a negative expiration", { token: TOKEN, environment: "production", payload: ALERT, expiration: -1 }, "expiration must be a whole number of seconds since 1970."],
    ["an expiration that isn't a number", { token: TOKEN, environment: "production", payload: ALERT, expiration: "soon" }, "expiration must be a whole number of seconds since 1970."],
  ])("refuses %s with 400", async (_label, body, message) => {
    const raw = typeof body === "string" ? body.slice(4) : undefined;
    const response = await handle(sendRequest(await relayKey(), body, { raw }), relayEnv(), relayDeps(apple().fetch));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request", message });
  });
});

describe("the Worker", () => {
  it("serves requests with the global fetch, the clock and the console", async () => {
    const globalFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const response = await relay.fetch(sendRequest(await relayKey(), { token: TOKEN, environment: "production", payload: ALERT }), relayEnv());
    expect(await response.json()).toMatchObject({ status: 200 });
    expect(globalFetch).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledOnce();
  });

  it("is deployed as spoonjoy-push-relay at push.spoonjoy.app for the app's bundle id", () => {
    const config = JSON.parse(readFileSync("workers/push-relay/wrangler.json", "utf8")) as {
      name: string;
      routes: Array<{ pattern: string; custom_domain: boolean }>;
      vars: Record<string, string>;
      ratelimits: Array<{ name: string }>;
    };
    expect(config.name).toBe("spoonjoy-push-relay");
    expect(config.routes).toEqual([{ pattern: "push.spoonjoy.app", custom_domain: true }]);
    // One documented address, and no invocation logs, which would keep request headers (relay keys).
    expect(config).toMatchObject({ workers_dev: false, observability: { logs: { invocation_logs: false } } });
    expect(config.vars.APNS_TOPIC).toBe("app.spoonjoy");
    expect(config.ratelimits.map((rule) => rule.name).sort()).toEqual(["REGISTER_LIMITER", "SEND_KEY_LIMITER", "SEND_TOKEN_LIMITER"]);
  });
});
