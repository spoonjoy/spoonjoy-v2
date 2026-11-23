import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM module shipped in the image, without types
import { checkHealth } from "../../self-host/health.mjs";

describe("checkHealth (the image's HEALTHCHECK)", () => {
  it("asks the server's readiness check, which touches the database and photo store", async () => {
    const asked: string[] = [];
    const code = await checkHealth({
      port: 8080,
      fetch: async (url: string) => { asked.push(url); return new Response(JSON.stringify({ status: "ready" }), { status: 200 }); },
    });
    expect(asked).toEqual(["http://127.0.0.1:8080/health/ready"]);
    expect(code).toBe(0);
  });

  it("is unhealthy when the readiness check answers anything but 200", async () => {
    expect(await checkHealth({ port: 8080, fetch: async () => new Response("{}", { status: 503 }) })).toBe(1);
  });

  it("uses the platform's fetch by default", async () => {
    // Port 9 (discard) on loopback: nothing answers there in a test run.
    expect(await checkHealth({ port: 9 })).toBe(1);
  });

  it("is unhealthy when the server does not answer", async () => {
    expect(await checkHealth({ port: 8080, fetch: async () => { throw new Error("ECONNREFUSED"); } })).toBe(1);
  });
});
