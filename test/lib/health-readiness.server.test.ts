// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { checkReadiness, READINESS_R2_KEY } from "~/lib/health.server";
import { loader } from "~/routes/health.ready";

function d1(result: unknown | Promise<unknown>) {
  const first = vi.fn(() => Promise.resolve(result));
  const prepare = vi.fn(() => ({ first }));
  return { db: { prepare } as unknown as D1Database, prepare, first };
}

function r2(head: () => Promise<unknown>) {
  const fn = vi.fn(head);
  return { bucket: { head: fn } as unknown as R2Bucket, head: fn };
}

describe("checkReadiness", () => {
  it("is ready when D1 answers SELECT 1 and R2 answers a head, even for a missing key", async () => {
    const db = d1({ ok: 1 });
    const photos = r2(async () => null);

    const result = await checkReadiness({ DB: db.db, PHOTOS: photos.bucket });

    expect(result.status).toBe("ready");
    expect(result.checks.d1.ok).toBe(true);
    expect(result.checks.r2.ok).toBe(true);
    expect(db.prepare).toHaveBeenCalledWith("SELECT 1 AS ok");
    expect(photos.head).toHaveBeenCalledWith(READINESS_R2_KEY);
  });

  it("is degraded when D1 throws, without leaking the error text", async () => {
    const db = { prepare: () => ({ first: () => Promise.reject(new Error("D1_ERROR: internal secret detail")) }) } as unknown as D1Database;
    const result = await checkReadiness({ DB: db, PHOTOS: r2(async () => null).bucket });

    expect(result.status).toBe("degraded");
    expect(result.checks.d1).toMatchObject({ ok: false, error: "error" });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result.checks.r2.ok).toBe(true);
  });

  it("is degraded when R2 hangs past the timeout", async () => {
    const result = await checkReadiness(
      { DB: d1({ ok: 1 }).db, PHOTOS: r2(() => new Promise(() => {})).bucket },
      { timeoutMs: 20 },
    );

    expect(result.status).toBe("degraded");
    expect(result.checks.r2).toMatchObject({ ok: false, error: "timeout" });
  });

  it("is degraded when D1 answers with something other than 1", async () => {
    const result = await checkReadiness({ DB: d1(null).db, PHOTOS: r2(async () => null).bucket });
    expect(result.checks.d1).toMatchObject({ ok: false, error: "unexpected result" });
  });

  it("is degraded when a binding is missing", async () => {
    const result = await checkReadiness({});
    expect(result.status).toBe("degraded");
    expect(result.checks.d1.error).toBe("binding missing");
    expect(result.checks.r2.error).toBe("binding missing");
  });
});

describe("GET /health/ready", () => {
  function args(env: Record<string, unknown> | undefined) {
    return {
      request: new Request("https://spoonjoy.app/health/ready"),
      params: {},
      context: { cloudflare: env ? { env } : undefined },
    } as unknown as Parameters<typeof loader>[0];
  }

  it("returns 200 and no-store when D1 and R2 are reachable", async () => {
    const response = await loader(args({ DB: d1({ ok: 1 }).db, PHOTOS: r2(async () => null).bucket }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ status: "ready" });
  });

  it("returns 503 when D1 is down so uptime checks see the outage", async () => {
    const db = { prepare: () => ({ first: () => Promise.reject(new Error("down")) }) };
    const response = await loader(args({ DB: db, PHOTOS: r2(async () => null).bucket }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "degraded", checks: { d1: { ok: false } } });
  });
});
