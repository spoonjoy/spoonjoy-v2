import { describe, it, expect } from "vitest";
import { loader } from "~/routes/api.push.public-key";

function routeArgs(env: Record<string, string | undefined>) {
  return {
    request: new Request("http://localhost/api/push/public-key"),
    params: {},
    context: { cloudflare: { env } },
  } as unknown as Parameters<typeof loader>[0];
}

describe("GET /api/push/public-key", () => {
  it("returns 200 + { key } with the public VAPID key when env is set", async () => {
    const env = {
      VAPID_PUBLIC_KEY: "PUB_KEY",
      VAPID_PRIVATE_KEY: "PRIV_KEY",
      VAPID_SUBJECT: "mailto:test@example.com",
    };
    const response = await loader(routeArgs(env));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { key: string };
    expect(body).toEqual({ key: "PUB_KEY" });
  });

  it("sets a public Cache-Control header of 1 hour", async () => {
    const env = {
      VAPID_PUBLIC_KEY: "PUB",
      VAPID_PRIVATE_KEY: "PRV",
      VAPID_SUBJECT: "mailto:t@e",
    };
    const response = await loader(routeArgs(env));
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  it("returns 500 when VAPID_PUBLIC_KEY is missing", async () => {
    const response = await loader(
      routeArgs({
        VAPID_PRIVATE_KEY: "PRIV",
        VAPID_SUBJECT: "mailto:test@example.com",
      }),
    );
    expect(response.status).toBe(500);
  });

  it("returns 500 when the env binding is null", async () => {
    const response = await loader({
      request: new Request("http://localhost/api/push/public-key"),
      params: {},
      context: { cloudflare: { env: null } },
    } as unknown as Parameters<typeof loader>[0]);
    expect(response.status).toBe(500);
  });

  it("does NOT require auth (no Cookie header set)", async () => {
    const env = {
      VAPID_PUBLIC_KEY: "PUB",
      VAPID_PRIVATE_KEY: "PRV",
      VAPID_SUBJECT: "mailto:t@e",
    };
    const response = await loader(routeArgs(env));
    expect(response.status).toBe(200);
  });
});
