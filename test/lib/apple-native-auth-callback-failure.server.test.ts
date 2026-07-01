import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleNativeAppleSignIn } from "~/lib/apple-native-auth.server";

const callbackMock = vi.hoisted(() => vi.fn());
const issueConnectorTokensMock = vi.hoisted(() => vi.fn());

vi.mock("~/lib/apple-oauth-callback.server", () => ({
  handleAppleOAuthCallback: callbackMock,
}));

vi.mock("~/lib/oauth-server.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/oauth-server.server")>()),
  issueConnectorTokens: issueConnectorTokensMock,
}));

function dbMock() {
  return {
    oAuthClient: {
      upsert: vi.fn(),
    },
  } as any;
}

function base64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signedAppleToken() {
  const keys = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const kid = "callback-failure-key";
  const rawNonce = "callback-failure-nonce";
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "RS256", kid });
  const payload = base64UrlJson({
    iss: "https://appleid.apple.com",
    aud: "app.spoonjoy.Spoonjoy",
    exp: now + 300,
    iat: now,
    sub: "apple-callback-failure-user",
    email: "callback-failure@example.com",
    nonce: await sha256Hex(rawNonce),
  });
  const signingInput = new TextEncoder().encode(`${header}.${payload}`);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, signingInput));

  return {
    identityToken: `${header}.${payload}.${base64Url(signature)}`,
    rawNonce,
    fetcher: vi.fn().mockResolvedValue(new Response(JSON.stringify({
      keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }],
    }))) as unknown as typeof fetch,
  };
}

describe("native Sign in with Apple callback failure handling", () => {
  beforeEach(() => {
    callbackMock.mockReset();
    issueConnectorTokensMock.mockReset();
  });

  it("converts Apple OAuth callback failures into native auth errors before issuing tokens", async () => {
    callbackMock.mockResolvedValueOnce({
      success: false,
      error: "email_already_taken",
      message: "Email is already linked to another chef.",
    });
    const fixture = await signedAppleToken();
    const db = dbMock();

    await expect(handleNativeAppleSignIn(
      db,
      { identityToken: fixture.identityToken, rawNonce: fixture.rawNonce },
      { clientIds: ["app.spoonjoy.Spoonjoy"] },
      { fetcher: fixture.fetcher },
    )).rejects.toMatchObject({
      code: "email_already_taken",
      status: 409,
    });
    expect(db.oAuthClient.upsert).not.toHaveBeenCalled();
  });

  it("uses default callback failure details when Apple OAuth does not return them", async () => {
    callbackMock.mockResolvedValueOnce({ success: false });
    const fixture = await signedAppleToken();

    await expect(handleNativeAppleSignIn(
      dbMock(),
      { identityToken: fixture.identityToken, rawNonce: fixture.rawNonce },
      { clientIds: ["app.spoonjoy.Spoonjoy"] },
      { fetcher: fixture.fetcher },
    )).rejects.toMatchObject({
      code: "apple_sign_in_failed",
      message: "Apple sign-in failed.",
      status: 409,
    });
  });

  it("normalizes non-created Apple callback actions to native login results", async () => {
    callbackMock.mockResolvedValueOnce({
      success: true,
      userId: "chef-linked",
      action: "account_linked",
    });
    issueConnectorTokensMock.mockResolvedValueOnce({
      accessToken: "sj_access",
      refreshToken: "ort_refresh",
      expiresIn: 900,
      scope: "account:read",
    });
    const fixture = await signedAppleToken();

    await expect(handleNativeAppleSignIn(
      dbMock(),
      { identityToken: fixture.identityToken, rawNonce: fixture.rawNonce },
      { clientIds: ["app.spoonjoy.Spoonjoy"] },
      { fetcher: fixture.fetcher },
    )).resolves.toMatchObject({
      action: "user_logged_in",
      userId: "chef-linked",
      tokens: { accessToken: "sj_access" },
    });
  });
});
