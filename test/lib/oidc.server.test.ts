// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OidcConfig } from "~/lib/env.server";
import {
  _resetOidcCachesForTests,
  createOidcAuthorizationURL,
  generateOidcNonce,
  oidcProviderKey,
  verifyOidcCallback,
} from "~/lib/oidc.server";

const ISSUER = "https://auth.example.test/realms/kitchen";
const config: OidcConfig = {
  issuer: ISSUER,
  clientId: "spoonjoy",
  clientSecret: "test-only-client-secret",
  label: "Sign in with Keycloak",
  scopes: ["openid", "email", "profile"],
};
const REDIRECT_URI = "https://kitchen.example.test/auth/oidc/callback";
const NOW = new Date("2026-11-22T12:00:00Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

function base64Url(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function jsonPart(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

type Signer = { alg: string; kid?: string; sign: (input: Uint8Array<ArrayBuffer>) => Promise<ArrayBuffer>; jwk?: JsonWebKey };

async function rsaSigner(kid = "rsa-1", alg = "RS256"): Promise<Signer> {
  const params = alg === "PS256"
    ? { name: "RSA-PSS", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }
    : { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: alg === "RS384" ? "SHA-384" : alg === "RS512" ? "SHA-512" : "SHA-256" };
  const pair = await crypto.subtle.generateKey(params, true, ["sign", "verify"]) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    alg,
    kid,
    jwk: { kty: jwk.kty, n: jwk.n, e: jwk.e, kid, use: "sig", alg } as JsonWebKey,
    sign: (input) => crypto.subtle.sign(alg === "PS256" ? { name: "RSA-PSS", saltLength: 32 } : "RSASSA-PKCS1-v1_5", pair.privateKey, input),
  };
}

async function ecSigner(kid = "ec-1"): Promise<Signer> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    alg: "ES256",
    kid,
    jwk: { kty: "EC", crv: jwk.crv, x: jwk.x, y: jwk.y, kid } as JsonWebKey,
    sign: (input) => crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, input),
  };
}

async function hmacSigner(secret = config.clientSecret): Promise<Signer> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return { alg: "HS256", sign: (input) => crypto.subtle.sign("HMAC", key, input) };
}

async function idToken(signer: Signer, claims: Record<string, unknown>, header: Record<string, unknown> = {}): Promise<string> {
  const head = jsonPart({ alg: signer.alg, typ: "JWT", ...(signer.kid ? { kid: signer.kid } : {}), ...header });
  const body = jsonPart(claims);
  const signature = await signer.sign(new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${base64Url(signature)}`;
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: ISSUER,
    aud: "spoonjoy",
    sub: "user-123",
    exp: NOW_SECONDS + 300,
    iat: NOW_SECONDS,
    nonce: "the-nonce",
    email: "chef@example.test",
    email_verified: true,
    name: "Chef Example",
    preferred_username: "chef",
    ...overrides,
  };
}

interface FakeProvider {
  discovery: Record<string, unknown> | null;
  keys: JsonWebKey[];
  tokenResponse: () => Promise<Response> | Response;
  userinfo: Record<string, unknown> | null;
  requests: Request[];
}

let provider: FakeProvider;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function stubProvider() {
  provider = {
    discovery: {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth?kc_idp_hint=local`,
      token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
      jwks_uri: `${ISSUER}/protocol/openid-connect/certs`,
      userinfo_endpoint: `${ISSUER}/protocol/openid-connect/userinfo`,
    },
    keys: [],
    tokenResponse: () => json({ access_token: "access", id_token: "unset" }),
    userinfo: null,
    requests: [],
  };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    provider.requests.push(request.clone());
    const path = new URL(request.url).pathname;
    if (path.endsWith("/.well-known/openid-configuration")) return json(provider.discovery);
    if (path.endsWith("/certs")) return json({ keys: provider.keys });
    if (path.endsWith("/token")) return provider.tokenResponse();
    if (path.endsWith("/userinfo")) return json(provider.userinfo);
    return new Response("not found", { status: 404 });
  }));
}

async function withToken(signer: Signer, tokenClaims = claims(), header?: Record<string, unknown>) {
  if (signer.jwk) provider.keys = [signer.jwk];
  const token = await idToken(signer, tokenClaims, header);
  provider.tokenResponse = () => json({ access_token: "access", token_type: "Bearer", id_token: token });
}

function verify(data: Partial<{ code: string; codeVerifier: string; nonce: string }> = {}, capture = vi.fn()) {
  return verifyOidcCallback(config, REDIRECT_URI, { code: "the-code", codeVerifier: "the-verifier", nonce: "the-nonce", ...data }, capture, NOW);
}

function requestsTo(suffix: string) {
  return provider.requests.filter((request) => new URL(request.url).pathname.endsWith(suffix));
}

describe("oidc.server", () => {
  beforeEach(() => {
    _resetOidcCachesForTests();
    stubProvider();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keys the OAuth link by the issuer, so another issuer never shares an account link", () => {
    expect(oidcProviderKey(config)).toBe(`oidc:${ISSUER}`);
    expect(oidcProviderKey({ issuer: "https://other.example.test" })).not.toBe(oidcProviderKey(config));
    expect(generateOidcNonce()).not.toBe(generateOidcNonce());
  });

  describe("createOidcAuthorizationURL", () => {
    it("sends the browser to the discovered endpoint with PKCE, state and a nonce", async () => {
      const url = await createOidcAuthorizationURL(config, REDIRECT_URI, "the-state", "the-verifier", "the-nonce");
      const expectedChallenge = base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("the-verifier")));

      expect(`${url.origin}${url.pathname}`).toBe(`${ISSUER}/protocol/openid-connect/auth`);
      expect(Object.fromEntries(url.searchParams)).toEqual({
        kc_idp_hint: "local",
        response_type: "code",
        client_id: "spoonjoy",
        redirect_uri: REDIRECT_URI,
        scope: "openid email profile",
        state: "the-state",
        nonce: "the-nonce",
        code_challenge: expectedChallenge,
        code_challenge_method: "S256",
      });
      expect(requestsTo("/.well-known/openid-configuration")[0]!.url).toBe(`${ISSUER}/.well-known/openid-configuration`);
    });

    it("reads the discovery document once and reuses it", async () => {
      await createOidcAuthorizationURL(config, REDIRECT_URI, "a", "verifier-a", "nonce-a");
      await createOidcAuthorizationURL(config, REDIRECT_URI, "b", "verifier-b", "nonce-b");
      expect(requestsTo("/.well-known/openid-configuration")).toHaveLength(1);
    });

    it("accepts a discovery issuer that differs only by a trailing slash", async () => {
      provider.discovery = { ...provider.discovery, issuer: `${ISSUER}/` };
      await expect(createOidcAuthorizationURL(config, REDIRECT_URI, "s", "v", "n")).resolves.toBeInstanceOf(URL);
    });

    it.each([
      ["names another issuer", { issuer: "https://evil.example.test" }, /another issuer/],
      ["has no issuer", { issuer: undefined }, /another issuer/],
      ["has no authorization endpoint", { authorization_endpoint: undefined }, /authorization_endpoint/],
      ["has an unusable token endpoint", { token_endpoint: "not a url" }, /token_endpoint/],
      ["has no keys address", { jwks_uri: 42 }, /jwks_uri/],
    ])("refuses a discovery document that %s", async (_label, change, message) => {
      provider.discovery = { ...provider.discovery, ...change };
      await expect(createOidcAuthorizationURL(config, REDIRECT_URI, "s", "v", "n")).rejects.toMatchObject({
        code: "upstream_error",
        phase: "discovery",
        retryable: false,
        message: expect.stringMatching(message),
      });
    });

    it("refuses an empty discovery answer", async () => {
      provider.discovery = null;
      await expect(createOidcAuthorizationURL(config, REDIRECT_URI, "s", "v", "n")).rejects.toMatchObject({ phase: "discovery" });
    });
  });

  describe("verifyOidcCallback", () => {
    it("exchanges the code with PKCE and client_secret_basic, and returns the verified user", async () => {
      await withToken(await rsaSigner());
      await expect(verify()).resolves.toEqual({
        success: true,
        oidcUser: { id: "user-123", email: "chef@example.test", emailVerified: true, name: "Chef Example", username: "chef" },
      });

      const [token] = requestsTo("/token");
      expect(token!.method).toBe("POST");
      expect(token!.headers.get("Authorization")).toBe(`Basic ${btoa("spoonjoy:test-only-client-secret")}`);
      expect(Object.fromEntries(new URLSearchParams(await token!.text()))).toEqual({
        grant_type: "authorization_code",
        code: "the-code",
        redirect_uri: REDIRECT_URI,
        code_verifier: "the-verifier",
      });
      expect(requestsTo("/userinfo")).toHaveLength(0);
    });

    it("form-encodes the client in the Basic header", async () => {
      await withToken(await hmacSigner("a secret:with/odd chars"));
      await verifyOidcCallback({ ...config, clientId: "kitchen app", clientSecret: "a secret:with/odd chars" }, REDIRECT_URI, { code: "c", codeVerifier: "v", nonce: "the-nonce" }, undefined, NOW);
      expect(requestsTo("/token")[0]!.headers.get("Authorization")).toBe(`Basic ${btoa("kitchen+app:a+secret%3Awith%2Fodd+chars")}`);
    });

    it("sends the client in the body to a provider that takes only client_secret_post", async () => {
      provider.discovery = { ...provider.discovery, token_endpoint_auth_methods_supported: ["client_secret_post"] };
      await withToken(await rsaSigner());
      await expect(verify()).resolves.toMatchObject({ success: true });

      const [token] = requestsTo("/token");
      expect(token!.headers.get("Authorization")).toBeNull();
      expect(new URLSearchParams(await token!.text()).get("client_secret")).toBe("test-only-client-secret");
    });

    it("keeps client_secret_basic when the provider lists it", async () => {
      provider.discovery = { ...provider.discovery, token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"] };
      await withToken(await rsaSigner());
      await verify();
      expect(requestsTo("/token")[0]!.headers.get("Authorization")).toMatch(/^Basic /);
    });

    it.each([["RS384"], ["RS512"], ["PS256"]])("accepts an %s ID token", async (alg) => {
      await withToken(await rsaSigner("rsa-x", alg));
      await expect(verify()).resolves.toMatchObject({ success: true });
    });

    it("accepts an ES256 ID token", async () => {
      await withToken(await ecSigner());
      await expect(verify()).resolves.toMatchObject({ success: true });
    });

    it("accepts an HS256 ID token signed with the client secret", async () => {
      await withToken(await hmacSigner());
      await expect(verify()).resolves.toMatchObject({ success: true });
      expect(requestsTo("/certs")).toHaveLength(0);
    });

    it("refuses an HS256 ID token signed with anything but the client secret", async () => {
      await withToken(await hmacSigner("someone-elses-secret"));
      await expect(verify()).resolves.toMatchObject({ success: false, error: "invalid_id_token", message: expect.stringMatching(/signature/) });
    });

    it("finds a key by type when the token names none", async () => {
      const signer = await rsaSigner();
      provider.keys = [{ kty: "EC", crv: "P-256", x: "x", y: "y" }, { ...signer.jwk!, kid: undefined, use: undefined, alg: undefined }];
      const token = await idToken({ ...signer, kid: undefined }, claims());
      provider.tokenResponse = () => json({ id_token: token });
      await expect(verify()).resolves.toMatchObject({ success: true });
    });

    it("fetches the keys again for a key it hasn't seen, as after a rotation", async () => {
      const first = await rsaSigner("old");
      await withToken(first);
      await verify();
      const rotated = await rsaSigner("new");
      await withToken(rotated);
      await expect(verify()).resolves.toMatchObject({ success: true });
      expect(requestsTo("/certs")).toHaveLength(2);
      await verify();
      expect(requestsTo("/certs")).toHaveLength(2);
    });

    it("refuses a token signed with a key the provider doesn't publish", async () => {
      const signer = await rsaSigner("unpublished");
      provider.keys = [(await rsaSigner("published")).jwk!];
      const token = await idToken(signer, claims());
      provider.tokenResponse = () => json({ id_token: token });
      await expect(verify()).resolves.toMatchObject({ error: "invalid_id_token", message: expect.stringMatching(/doesn't publish/) });
      expect(requestsTo("/certs")).toHaveLength(2);
    });

    it("refuses a token whose signature doesn't match its published key", async () => {
      const signer = await rsaSigner("k");
      provider.keys = [{ ...(await rsaSigner("k")).jwk! }];
      const token = await idToken(signer, claims());
      provider.tokenResponse = () => json({ id_token: token });
      await expect(verify()).resolves.toMatchObject({ error: "invalid_id_token", message: expect.stringMatching(/signature/) });
    });

    it("refuses a published key it can't read", async () => {
      const signer = await ecSigner("broken");
      provider.keys = [{ kty: "EC", kid: "broken", crv: "P-999", x: "AA", y: "AA" }];
      const token = await idToken(signer, claims());
      provider.tokenResponse = () => json({ id_token: token });
      await expect(verify()).resolves.toMatchObject({ error: "invalid_id_token", message: expect.stringMatching(/can't read/) });
    });

    it("treats a key set with no keys as having none", async () => {
      const signer = await rsaSigner();
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        const request = new Request(input, init);
        const path = new URL(request.url).pathname;
        if (path.endsWith("/certs")) return json({ keys: "none" });
        if (path.endsWith("/token")) return json({ id_token: await idToken(signer, claims()) });
        return json(provider.discovery);
      });
      await expect(verify()).resolves.toMatchObject({ error: "invalid_id_token", message: expect.stringMatching(/doesn't publish/) });
    });

    it.each([
      ["none", { alg: "none" }],
      ["an unknown algorithm", { alg: "XS999" }],
    ])("refuses a token signed with %s", async (_label, header) => {
      await withToken(await rsaSigner(), claims(), header);
      await expect(verify()).resolves.toMatchObject({ error: "invalid_id_token", message: expect.stringMatching(/algorithm/) });
    });

    it.each([
      ["another issuer", { iss: "https://evil.example.test" }, /another provider/],
      ["another audience", { aud: "someone-else" }, /another client/],
      ["another authorized party", { aud: ["spoonjoy", "other"], azp: "other" }, /another client/],
      ["no expiry", { exp: undefined }, /expired/],
      ["an expiry past the allowed skew", { exp: NOW_SECONDS - 61 }, /expired/],
      ["an issue time in the future", { iat: NOW_SECONDS + 120 }, /not valid yet/],
      ["another nonce", { nonce: "replayed" }, /nonce/],
      ["no nonce", { nonce: undefined }, /nonce/],
      ["no subject", { sub: " " }, /names no user/],
    ])("refuses a token with %s", async (_label, change, message) => {
      const capture = vi.fn();
      await withToken(await rsaSigner(), claims(change));
      await expect(verify({}, capture)).resolves.toEqual({
        success: false,
        error: "invalid_id_token",
        message: expect.stringMatching(message),
        failureKind: "client",
        retryable: false,
      });
      expect(capture).toHaveBeenCalledWith(expect.objectContaining({ phase: "verify", failureKind: "client" }));
    });

    it("accepts an audience list holding this client, and an expiry within the allowed skew", async () => {
      await withToken(await rsaSigner(), claims({ aud: ["spoonjoy", "other"], azp: "spoonjoy", exp: NOW_SECONDS - 30, iat: undefined }));
      await expect(verify()).resolves.toMatchObject({ success: true });
    });

    it.each([
      ["no ID token", { access_token: "a" }],
      ["an ID token that isn't a string", { id_token: 42 }],
      ["an ID token with an empty part", { id_token: "a..c" }],
      ["an ID token that isn't JSON", { id_token: "bm90IGpzb24.bm90IGpzb24.c2ln" }],
      ["an ID token whose header isn't an object", { id_token: `${jsonPart(7)}.${jsonPart({})}.c2ln` }],
    ])("refuses a token answer with %s", async (_label, body) => {
      provider.tokenResponse = () => json(body);
      await expect(verify()).resolves.toMatchObject({ success: false, error: "invalid_id_token" });
    });

    it("refuses an empty token answer", async () => {
      provider.tokenResponse = () => json(null);
      await expect(verify()).resolves.toMatchObject({ success: false, error: "invalid_id_token" });
    });

    it("reads the email from userinfo when the ID token has none, for the same subject only", async () => {
      await withToken(await rsaSigner(), claims({ email: undefined, email_verified: undefined, name: undefined, preferred_username: undefined }));
      provider.userinfo = { sub: "user-123", email: "chef@example.test", email_verified: "true" };
      await expect(verify()).resolves.toEqual({
        success: true,
        oidcUser: { id: "user-123", email: "chef@example.test", emailVerified: true, name: null, username: "chef@example.test" },
      });
      expect(requestsTo("/userinfo")[0]!.headers.get("Authorization")).toBe("Bearer access");

      _resetOidcCachesForTests();
      provider.userinfo = { sub: "someone-else", email: "victim@example.test", email_verified: true };
      await expect(verify()).resolves.toMatchObject({ oidcUser: { id: "user-123", email: null, emailVerified: false, username: "user-123" } });
    });

    it("signs in with no email when there is no userinfo endpoint or access token", async () => {
      const signer = await rsaSigner();
      provider.discovery = { ...provider.discovery, userinfo_endpoint: undefined };
      await withToken(signer, claims({ email: undefined }));
      await expect(verify()).resolves.toMatchObject({ oidcUser: { email: null, emailVerified: false } });

      _resetOidcCachesForTests();
      stubProvider();
      const token = await idToken(signer, claims({ email: undefined }));
      provider.keys = [signer.jwk!];
      provider.tokenResponse = () => json({ id_token: token });
      await expect(verify()).resolves.toMatchObject({ oidcUser: { email: null } });
      expect(requestsTo("/userinfo")).toHaveLength(0);
    });

    it("treats an empty userinfo answer as no claims", async () => {
      await withToken(await rsaSigner(), claims({ email: undefined }));
      provider.userinfo = null;
      await expect(verify()).resolves.toMatchObject({ oidcUser: { email: null } });
    });

    it("counts an email the provider hasn't verified as unverified", async () => {
      await withToken(await rsaSigner(), claims({ email_verified: false }));
      await expect(verify()).resolves.toMatchObject({ oidcUser: { email: "chef@example.test", emailVerified: false } });
    });

    it("asks for a code before calling the provider", async () => {
      await expect(verify({ code: "" })).resolves.toMatchObject({ success: false, error: "invalid_code", failureKind: "client" });
      expect(provider.requests).toHaveLength(0);
    });

    it("reports a token endpoint that refuses the code as an upstream error, without retry", async () => {
      const capture = vi.fn();
      provider.tokenResponse = () => json({ error: "invalid_grant" }, 400);
      await expect(verify({}, capture)).resolves.toMatchObject({ success: false, error: "upstream_error", retryable: false });
      expect(capture).toHaveBeenCalledWith(expect.objectContaining({ phase: "token_exchange", httpStatus: 400 }));
    });

    it("reports an unreachable provider as a network error", async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));
      const capture = vi.fn();
      await expect(verify({}, capture)).resolves.toMatchObject({ success: false, error: "network_error", retryable: true });
      expect(capture).toHaveBeenCalledWith(expect.objectContaining({ phase: "discovery", error: expect.any(TypeError) }));
    });

    it("works without a capture callback", async () => {
      provider.tokenResponse = () => json({}, 500);
      await expect(verifyOidcCallback(config, REDIRECT_URI, { code: "c", codeVerifier: "v", nonce: "n" })).resolves.toMatchObject({ error: "upstream_error" });
      provider.tokenResponse = () => json({ id_token: "x.y" });
      await expect(verifyOidcCallback(config, REDIRECT_URI, { code: "c", codeVerifier: "v", nonce: "n" })).resolves.toMatchObject({ error: "invalid_id_token" });
    });

    it("rethrows an unexpected failure for the route to capture", async () => {
      provider.tokenResponse = () => json({ id_token: "a.b.c" });
      vi.spyOn(crypto.subtle, "verify").mockRejectedValueOnce(new Error("boom"));
      const signer = await hmacSigner();
      provider.tokenResponse = () => idToken(signer, claims()).then((token) => json({ id_token: token }));
      await expect(verify()).rejects.toThrow("boom");
      vi.restoreAllMocks();
    });

    it("fetches discovery again once its cached copy is an hour old", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(NOW);
        await createOidcAuthorizationURL(config, REDIRECT_URI, "s", "v", "n");
        vi.setSystemTime(new Date(NOW.getTime() + 61 * 60 * 1000));
        await createOidcAuthorizationURL(config, REDIRECT_URI, "s", "v", "n");
        expect(requestsTo("/.well-known/openid-configuration")).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
