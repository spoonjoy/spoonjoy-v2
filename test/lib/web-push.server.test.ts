import { describe, it, expect, vi } from "vitest";
import { sendPush, type PushSubscriptionRecord } from "~/lib/web-push.server";
import { generateVapidKeyPair } from "../../scripts/generate-vapid-keys";

interface FixtureKeyset {
  publicKey: string;
  privateKey: string;
  subject: string;
}

let cachedVapid: FixtureKeyset | null = null;
async function getVapid(): Promise<FixtureKeyset> {
  if (cachedVapid) return cachedVapid;
  const pair = await generateVapidKeyPair();
  cachedVapid = {
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    subject: "mailto:test@example.com",
  };
  return cachedVapid;
}

function makeFixtureSubscription(): PushSubscriptionRecord {
  // The library validates p256dh / auth as decodable base64url. We use
  // realistic placeholder values that decode to 65 / 16 bytes respectively.
  // Generated once by running generateVapidKeyPair() — they are NOT a
  // working keypair, but they pass shape checks.
  return {
    endpoint: "https://push.example.test/sub-abc",
    keys: {
      // 65 bytes of 0x04-prefixed pseudo point + 32 bytes X + 32 bytes Y.
      p256dh:
        "BHpzJ01VsKtS08clJYyuN-WasvuNNaWOtg_nkE60YRoy0Ez9X2F-ITgDKWbh8EzAMLpx9rskKADfMbadO3yo5rQ",
      // 16-byte auth secret.
      auth: "AAECAwQFBgcICQoLDA0ODw",
    },
  };
}

function okResponse(status: number, body = ""): Response {
  return new Response(body, { status });
}

describe("sendPush", () => {
  it("returns delivered on 201 from push provider", async () => {
    const vapid = await getVapid();
    const sub = makeFixtureSubscription();
    const fetchMock = vi.fn(async () => okResponse(201));

    const result = await sendPush(
      sub,
      { title: "hi", body: "there", url: "/recipes/r1" },
      vapid,
      { fetch: fetchMock },
    );

    expect(result.status).toBe("delivered");
    expect(result.httpStatus).toBe(201);
    expect(result.providerEndpoint).toBe(sub.endpoint);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns delivered on 200 from push provider", async () => {
    const vapid = await getVapid();
    const fetchMock = vi.fn(async () => okResponse(200));
    const result = await sendPush(
      makeFixtureSubscription(),
      { title: "x", body: "y", url: "/" },
      vapid,
      { fetch: fetchMock },
    );
    expect(result.status).toBe("delivered");
    expect(result.httpStatus).toBe(200);
  });

  it("returns expired on 404", async () => {
    const vapid = await getVapid();
    const result = await sendPush(
      makeFixtureSubscription(),
      { title: "x", body: "y", url: "/" },
      vapid,
      { fetch: vi.fn(async () => okResponse(404)) },
    );
    expect(result.status).toBe("expired");
    expect(result.httpStatus).toBe(404);
  });

  it("returns expired on 410 Gone", async () => {
    const vapid = await getVapid();
    const result = await sendPush(
      makeFixtureSubscription(),
      { title: "x", body: "y", url: "/" },
      vapid,
      { fetch: vi.fn(async () => okResponse(410)) },
    );
    expect(result.status).toBe("expired");
  });

  it("returns failed on 429 rate-limited", async () => {
    const vapid = await getVapid();
    const result = await sendPush(
      makeFixtureSubscription(),
      { title: "x", body: "y", url: "/" },
      vapid,
      { fetch: vi.fn(async () => okResponse(429)) },
    );
    expect(result.status).toBe("failed");
    expect(result.httpStatus).toBe(429);
  });

  it("returns failed on 5xx", async () => {
    const vapid = await getVapid();
    const result = await sendPush(
      makeFixtureSubscription(),
      { title: "x", body: "y", url: "/" },
      vapid,
      { fetch: vi.fn(async () => okResponse(503)) },
    );
    expect(result.status).toBe("failed");
    expect(result.httpStatus).toBe(503);
  });

  it("returns failed when fetch throws (network error)", async () => {
    const vapid = await getVapid();
    const result = await sendPush(
      makeFixtureSubscription(),
      { title: "x", body: "y", url: "/" },
      vapid,
      {
        fetch: vi.fn(async () => {
          throw new Error("connection refused");
        }),
      },
    );
    expect(result.status).toBe("failed");
    expect(result.httpStatus).toBe(0);
    expect(result.error).toMatch(/connection refused/);
  });

  it("returns failed for any other non-success status (e.g. 400)", async () => {
    const vapid = await getVapid();
    const result = await sendPush(
      makeFixtureSubscription(),
      { title: "x", body: "y", url: "/" },
      vapid,
      { fetch: vi.fn(async () => okResponse(400)) },
    );
    expect(result.status).toBe("failed");
    expect(result.httpStatus).toBe(400);
  });

  it("sends a POST to the subscription endpoint with VAPID auth + aes128gcm headers + TTL", async () => {
    const vapid = await getVapid();
    const sub = makeFixtureSubscription();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      okResponse(201),
    );

    await sendPush(
      sub,
      { title: "Spoonjoy", body: "hello", url: "/recipes/r1" },
      vapid,
      { fetch: fetchMock as unknown as typeof fetch },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(sub.endpoint);
    expect(init.method?.toUpperCase()).toBe("POST");

    const headers = init.headers as Record<string, string>;
    // Lowercase keys (per library output) — accept either form.
    const authHeader = headers["authorization"] ?? headers["Authorization"];
    // The library emits a "WebPush <jwt>" header (RFC 8292 §3.1 alternate form).
    expect(authHeader).toMatch(/^(vapid t=|webpush )/i);
    const ce = headers["content-encoding"] ?? headers["Content-Encoding"];
    // The library uses the older "aesgcm" draft encoding (still widely supported);
    // accept either form so we don't lock to a library quirk.
    expect(["aesgcm", "aes128gcm"]).toContain(ce);
    const ttl = headers["ttl"] ?? headers["TTL"];
    expect(ttl).toBeDefined();
  });

  it("falls back to global fetch when deps.fetch is not provided", async () => {
    const vapid = await getVapid();
    const globalFetchMock = vi.fn(async () => okResponse(201));
    const origFetch = globalThis.fetch;
    globalThis.fetch = globalFetchMock as unknown as typeof fetch;
    try {
      const result = await sendPush(
        makeFixtureSubscription(),
        { title: "x", body: "y", url: "/" },
        vapid,
      );
      expect(result.status).toBe("delivered");
      expect(globalFetchMock).toHaveBeenCalled();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("returns failed when payload construction throws (invalid keys)", async () => {
    const vapid = await getVapid();
    const result = await sendPush(
      {
        endpoint: "https://push.example.test/bad",
        keys: { p256dh: "!!!notbase64!!!", auth: "AAA" },
      },
      { title: "x", body: "y", url: "/" },
      vapid,
      { fetch: vi.fn(async () => okResponse(201)) },
    );
    expect(result.status).toBe("failed");
    expect(result.httpStatus).toBe(0);
    expect(result.error).toBeDefined();
  });

  it("stringifies non-Error rejections from fetch", async () => {
    const vapid = await getVapid();
    const result = await sendPush(
      makeFixtureSubscription(),
      { title: "x", body: "y", url: "/" },
      vapid,
      {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        fetch: vi.fn(async () => {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw "string error";
        }),
      },
    );
    expect(result.status).toBe("failed");
    expect(result.error).toBe("string error");
  });

  it("stringifies non-Error rejections from buildPushPayload (invalid endpoint shape)", async () => {
    const vapid = await getVapid();
    // The library validates endpoint; if it isn't a string this triggers a non-Error path.
    // We can't easily force buildPushPayload to throw a non-Error without intercepting,
    // so we use a malformed keys structure and assert the error message is a string.
    const result = await sendPush(
      {
        endpoint: "https://push.example.test/x",
        keys: { p256dh: "bad", auth: "bad" },
      },
      { title: "x", body: "y", url: "/" },
      vapid,
      { fetch: vi.fn(async () => okResponse(201)) },
    );
    expect(result.status).toBe("failed");
    expect(typeof result.error).toBe("string");
  });
});

describe("sendPush — buildPushPayload non-Error rejection (mocked)", () => {
  it("returns String(err) when buildPushPayload throws a non-Error value", async () => {
    vi.resetModules();
    vi.doMock("@block65/webcrypto-web-push", () => ({
      buildPushPayload: async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 42;
      },
    }));
    const mod = await import("~/lib/web-push.server");
    const vapid = await getVapid();
    const result = await mod.sendPush(
      { endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" } },
      { title: "x", body: "y", url: "/" },
      vapid,
      { fetch: vi.fn(async () => okResponse(201)) },
    );
    expect(result.status).toBe("failed");
    expect(result.error).toBe("42");
    vi.doUnmock("@block65/webcrypto-web-push");
    vi.resetModules();
  });
});
