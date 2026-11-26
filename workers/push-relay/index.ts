/**
 * Spoonjoy push relay: the one place that holds Apple's push key (APNs), so any Spoonjoy server,
 * spoonjoy.app or one someone runs at home, can notify the Spoonjoy iPhone, iPad and Mac app.
 *
 *   GET  /health       whether the relay is up, and whether its Apple key and relay keys are set.
 *   POST /v1/servers   a server registers its address and gets a relay key, limited per IP address.
 *   POST /v1/send      with that key as a bearer token: one notification to one device. The relay
 *                      signs Apple's provider token (ES256, cached for 50 minutes), sends to
 *                      api.push.apple.com or api.sandbox.push.apple.com and answers with Apple's
 *                      status. `revoke: true` means Apple says the token is dead, so the server
 *                      stops sending to that device.
 *
 * It keeps nothing: a relay key is the server's id signed with RELAY_KEY_SECRET (HMAC-SHA256), so
 * checking one needs no storage, and the rate limits count by key, by a hash of the device token
 * and by IP address. Payloads and tokens pass through and are never logged. A server id listed in
 * REVOKED_SERVER_IDS is refused. Until APNS_KEY_P8 and APNS_KEY_ID are set (APNS_TEAM_ID is a var),
 * sending answers 503 not_configured; until RELAY_KEY_SECRET is set, so does registering.
 */

/** The Workers Rate Limiting binding (wrangler.json `ratelimits`). */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface RelayEnv {
  /** The app's bundle id, which APNs calls the topic. */
  APNS_TOPIC: string;
  /** The Apple developer team that owns the key. */
  APNS_TEAM_ID?: string;
  /** The APNs auth key's id (the XXXXXXXXXX in AuthKey_XXXXXXXXXX.p8). */
  APNS_KEY_ID?: string;
  /** The APNs auth key: the .p8 file's PEM text. */
  APNS_KEY_P8?: string;
  /** Signs relay keys. */
  RELAY_KEY_SECRET?: string;
  /** Server ids, separated by commas, whose keys the relay refuses. */
  REVOKED_SERVER_IDS?: string;
  REGISTER_LIMITER: RateLimiter;
  SEND_KEY_LIMITER: RateLimiter;
  SEND_TOKEN_LIMITER: RateLimiter;
}

export interface RelayDeps {
  fetch: typeof fetch;
  /** Milliseconds since the epoch. */
  now: () => number;
  log: (line: string) => void;
}

export const APNS_HOSTS = {
  production: "https://api.push.apple.com",
  development: "https://api.sandbox.push.apple.com",
} as const;
export type ApnsEnvironment = keyof typeof APNS_HOSTS;

/** Apple wants a provider token refreshed between 20 and 60 minutes after it was made. */
export const PROVIDER_TOKEN_TTL_MS = 50 * 60_000;
export const APNS_TIMEOUT_MS = 10_000;
/** Apple's limit on an alert's payload. */
export const MAX_PAYLOAD_BYTES = 4096;
export const MAX_BASE_URL_LENGTH = 2048;
const MAX_BODY_BYTES = 16_384;
const MAX_COLLAPSE_ID_BYTES = 64;
/** Device tokens are 32 bytes (64 hex digits) today; Apple says they may grow. */
const DEVICE_TOKEN = /^[0-9a-f]{64,200}$/i;
const KEY_PREFIX = "sjr1";
// Changing this label makes every relay key issued under the old one fail.
const KEY_LABEL = "spoonjoy push relay key v1";
/** Apple's reasons that mean the token will never work again for this app. */
const DEAD_TOKEN_REASONS = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"]);

const encoder = new TextEncoder();

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function refuse(status: number, error: string, message: string): Response {
  return json({ error, message }, status);
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function present(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function apnsConfigured(env: RelayEnv): boolean {
  return Boolean(present(env.APNS_KEY_P8) && present(env.APNS_KEY_ID) && present(env.APNS_TEAM_ID));
}

// ---- Relay keys --------------------------------------------------------------------------------

async function keySigner(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** A new server's id and its relay key, `sjr1.<id>.<signature>`. */
export async function issueRelayKey(secret: string): Promise<{ serverId: string; relayKey: string }> {
  const serverId = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await keySigner(secret), encoder.encode(`${KEY_LABEL}\u0000${serverId}`)));
  return { serverId, relayKey: `${KEY_PREFIX}.${serverId}.${base64url(signature)}` };
}

/** The server id a relay key was issued to, or null when this secret didn't sign it. */
export async function verifyRelayKey(secret: string, relayKey: string): Promise<string | null> {
  const parts = relayKey.split(".");
  if (parts.length !== 3 || parts[0] !== KEY_PREFIX || !/^[A-Za-z0-9_-]{22}$/.test(parts[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) {
    return null;
  }
  const [, serverId, signature] = parts;
  const valid = await crypto.subtle.verify("HMAC", await keySigner(secret), fromBase64url(signature), encoder.encode(`${KEY_LABEL}\u0000${serverId}`));
  return valid ? serverId : null;
}

function revokedServers(env: RelayEnv): Set<string> {
  return new Set((env.REVOKED_SERVER_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean));
}

// ---- Apple's provider token --------------------------------------------------------------------

type CachedProviderToken = { token: string; madeAt: number; identity: string };
let cachedProviderToken: CachedProviderToken | null = null;

/** Forget the cached provider token (tests, and after Apple refuses one). */
export function resetProviderTokenCache(): void {
  cachedProviderToken = null;
}

async function importApnsKey(p8: string): Promise<CryptoKey> {
  const body = p8.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  return crypto.subtle.importKey("pkcs8", fromBase64url(body), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/**
 * Apple's provider token: a JWT signed with the team's APNs key (ES256), made at most once every
 * 50 minutes, since Apple refuses tokens made more often than every 20 minutes or older than an hour.
 */
export async function providerToken(env: RelayEnv, now: number): Promise<string> {
  const teamId = present(env.APNS_TEAM_ID)!;
  const keyId = present(env.APNS_KEY_ID)!;
  const p8 = present(env.APNS_KEY_P8)!;
  const identity = `${teamId}.${keyId}.${p8.length}`;
  if (cachedProviderToken && cachedProviderToken.identity === identity && now - cachedProviderToken.madeAt < PROVIDER_TOKEN_TTL_MS) {
    return cachedProviderToken.token;
  }
  const header = base64url(encoder.encode(JSON.stringify({ alg: "ES256", kid: keyId })));
  const claims = base64url(encoder.encode(JSON.stringify({ iss: teamId, iat: Math.floor(now / 1000) })));
  const signingInput = `${header}.${claims}`;
  // WebCrypto's ECDSA signature is r || s, which is JWS's ES256 form already.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await importApnsKey(p8), encoder.encode(signingInput)),
  );
  const token = `${signingInput}.${base64url(signature)}`;
  cachedProviderToken = { token, madeAt: now, identity };
  return token;
}

// ---- Requests ----------------------------------------------------------------------------------

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (encoder.encode(text).length > MAX_BODY_BYTES) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value.toLowerCase())));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

async function register(request: Request, env: RelayEnv, deps: RelayDeps): Promise<Response> {
  const secret = present(env.RELAY_KEY_SECRET);
  if (!secret) return refuse(503, "not_configured", "This relay can't issue keys yet.");
  if (!(await env.REGISTER_LIMITER.limit({ key: `ip:${clientIp(request)}` })).success) {
    return refuse(429, "rate_limited", "Too many registrations from this address; try again in a minute.");
  }
  const body = await readJson(request);
  const baseUrl = body?.baseUrl;
  let url: URL | null = null;
  if (typeof baseUrl === "string" && baseUrl.length <= MAX_BASE_URL_LENGTH) {
    try {
      url = new URL(baseUrl);
    } catch {
      url = null;
    }
  }
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
    return refuse(400, "invalid_request", "Send { baseUrl } with your server's http:// or https:// address.");
  }
  const issued = await issueRelayKey(secret);
  deps.log(JSON.stringify({ event: "server-registered", serverId: issued.serverId, origin: url.origin }));
  return json(issued, 201);
}

type SendRequest = {
  token: string;
  environment: ApnsEnvironment;
  payload: Record<string, unknown>;
  payloadText: string;
  pushType: "alert" | "background";
  collapseId?: string;
  expiration?: number;
};

function parseSend(body: Record<string, unknown> | null): SendRequest | string {
  if (!body) return "The body must be a JSON object.";
  const { token, environment, payload, pushType = "alert", collapseId, expiration } = body;
  if (typeof token !== "string" || !DEVICE_TOKEN.test(token)) return "token must be the device token in hex.";
  if (environment !== "production" && environment !== "development") return "environment must be development or production.";
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "payload must be an object.";
  const aps = (payload as Record<string, unknown>).aps;
  if (!aps || typeof aps !== "object" || Array.isArray(aps)) return "payload.aps must be an object.";
  const payloadText = JSON.stringify(payload);
  if (encoder.encode(payloadText).length > MAX_PAYLOAD_BYTES) return `payload must be at most ${MAX_PAYLOAD_BYTES} bytes.`;
  if (pushType !== "alert" && pushType !== "background") return "pushType must be alert or background.";
  if (collapseId !== undefined && (typeof collapseId !== "string" || collapseId === "" || encoder.encode(collapseId).length > MAX_COLLAPSE_ID_BYTES)) {
    return `collapseId must be a string of at most ${MAX_COLLAPSE_ID_BYTES} bytes.`;
  }
  if (expiration !== undefined && (typeof expiration !== "number" || !Number.isInteger(expiration) || expiration < 0)) {
    return "expiration must be a whole number of seconds since 1970.";
  }
  return {
    token: token.toLowerCase(),
    environment,
    payload: payload as Record<string, unknown>,
    payloadText,
    pushType,
    ...(collapseId === undefined ? {} : { collapseId }),
    ...(expiration === undefined ? {} : { expiration }),
  };
}

async function postToApple(env: RelayEnv, send: SendRequest, deps: RelayDeps): Promise<Response> {
  const headers: Record<string, string> = {
    authorization: `bearer ${await providerToken(env, deps.now())}`,
    "apns-topic": env.APNS_TOPIC,
    "apns-push-type": send.pushType,
    // Apple requires priority 5 for background pushes; alerts go at once.
    "apns-priority": send.pushType === "background" ? "5" : "10",
    "content-type": "application/json",
  };
  if (send.collapseId) headers["apns-collapse-id"] = send.collapseId;
  if (send.expiration !== undefined) headers["apns-expiration"] = String(send.expiration);
  return deps.fetch(`${APNS_HOSTS[send.environment]}/3/device/${send.token}`, {
    method: "POST",
    headers,
    body: send.payloadText,
    signal: AbortSignal.timeout(APNS_TIMEOUT_MS),
  });
}

async function appleReason(response: Response): Promise<string | null> {
  const text = await response.text();
  try {
    const reason = (JSON.parse(text) as { reason?: unknown }).reason;
    return typeof reason === "string" ? reason : null;
  } catch {
    return null;
  }
}

async function send(request: Request, env: RelayEnv, deps: RelayDeps): Promise<Response> {
  const secret = present(env.RELAY_KEY_SECRET);
  const auth = request.headers.get("authorization") ?? "";
  const relayKey = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
  const serverId = secret && relayKey ? await verifyRelayKey(secret, relayKey) : null;
  if (!serverId) return refuse(401, "unauthorized", "Send your relay key as a bearer token.");
  if (revokedServers(env).has(serverId)) return refuse(403, "revoked", "This relay key was revoked.");
  if (!(await env.SEND_KEY_LIMITER.limit({ key: `server:${serverId}` })).success) {
    return refuse(429, "rate_limited", "Too many notifications from this server; try again in a minute.");
  }
  const parsed = parseSend(await readJson(request));
  if (typeof parsed === "string") return refuse(400, "invalid_request", parsed);
  if (!(await env.SEND_TOKEN_LIMITER.limit({ key: `token:${await sha256Hex(parsed.token)}` })).success) {
    return refuse(429, "rate_limited", "Too many notifications to this device; try again in a minute.");
  }
  if (!apnsConfigured(env)) return refuse(503, "not_configured", "This relay has no Apple push key yet.");

  let response: Response;
  try {
    response = await postToApple(env, parsed, deps);
    // A provider token Apple calls expired is made again once, in case the cache outlived it. An
    // invalid one isn't: a new token from the same key would be refused too, and Apple refuses
    // tokens made more often than every 20 minutes.
    if (response.status === 403) {
      if ((await appleReason(response.clone())) === "ExpiredProviderToken") {
        resetProviderTokenCache();
        response = await postToApple(env, parsed, deps);
      }
    }
  } catch (error) {
    deps.log(JSON.stringify({ event: "apns-unreachable", serverId, error: error instanceof Error ? error.name : "Error" }));
    return refuse(502, "apns_unreachable", "Apple's push service didn't answer.");
  }
  const reason = response.ok ? null : await appleReason(response);
  const revoke = response.status === 410 || (response.status === 400 && reason !== null && DEAD_TOKEN_REASONS.has(reason));
  deps.log(JSON.stringify({ event: "sent", serverId, environment: parsed.environment, status: response.status, reason }));
  return json({ status: response.status, reason, apnsId: response.headers.get("apns-id"), revoke });
}

export async function handle(request: Request, env: RelayEnv, deps: RelayDeps): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === "/health" && (request.method === "GET" || request.method === "HEAD")) {
    return json({
      ok: true,
      service: "spoonjoy-push-relay",
      apns: apnsConfigured(env) ? "configured" : "not configured",
      registration: present(env.RELAY_KEY_SECRET) ? "open" : "not configured",
    });
  }
  if (pathname === "/v1/servers") {
    return request.method === "POST" ? register(request, env, deps) : refuse(405, "method_not_allowed", "Use POST.");
  }
  if (pathname === "/v1/send") {
    return request.method === "POST" ? send(request, env, deps) : refuse(405, "method_not_allowed", "Use POST.");
  }
  return refuse(404, "not_found", "See https://github.com/spoonjoy/spoonjoy-v2/blob/main/docs/push-relay.md");
}

export default {
  fetch(request: Request, env: RelayEnv): Promise<Response> {
    return handle(request, env, { fetch: (input, init) => fetch(input, init), now: Date.now, log: (line) => console.log(line) });
  },
};
