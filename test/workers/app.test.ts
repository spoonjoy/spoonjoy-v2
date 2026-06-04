// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const requestHandler = vi.fn(async () => new Response("handled"));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    createRequestHandler: vi.fn(() => requestHandler),
  };
});

const worker = (await import("../../workers/app")).default;

function context() {
  return { waitUntil: vi.fn() } as unknown as ExecutionContext;
}

describe("Cloudflare worker app", () => {
  it("answers OAuth CORS preflights before React Router handles methods", async () => {
    requestHandler.mockClear();

    const response = await worker.fetch(
      new Request("https://spoonjoy.app/oauth/token", {
        method: "OPTIONS",
        headers: {
          Origin: "https://client.example",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "Content-Type",
        },
      }),
      {} as CloudflareEnvironment,
      context(),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(requestHandler).not.toHaveBeenCalled();
  });

  it("does not redirect OAuth preflights from the canonical www host", async () => {
    requestHandler.mockClear();

    const response = await worker.fetch(
      new Request("https://www.spoonjoy.app/oauth/register", {
        method: "OPTIONS",
        headers: { Origin: "https://client.example" },
      }),
      {} as CloudflareEnvironment,
      context(),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Location")).toBeNull();
    expect(requestHandler).not.toHaveBeenCalled();
  });

  it("still routes non-preflight requests through React Router", async () => {
    requestHandler.mockClear();

    const response = await worker.fetch(
      new Request("https://spoonjoy.app/oauth/token", { method: "POST" }),
      {} as CloudflareEnvironment,
      context(),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("handled");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(requestHandler).toHaveBeenCalledTimes(1);
  });
});
