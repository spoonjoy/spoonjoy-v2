import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error -- plain ESM module shipped in the image, without types
import { DEFAULT_PUSH_RELAY_URL, pushRelayUrl, REGISTER_TIMEOUT_MS, serverPushRelayKey } from "../../self-host/push-relay.mjs";

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "spoonjoy-push-relay-test-"));
  file = path.join(dir, "push-relay.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function relay(status: number, body: unknown = { serverId: "srv1", relayKey: "sjr1.srv1.sig" }) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

const BASE = "https://kitchen.example.com";

describe("pushRelayUrl", () => {
  it("is the relay's address unless the owner names another relay or turns it off", () => {
    expect(pushRelayUrl({})).toBe(DEFAULT_PUSH_RELAY_URL);
    expect(pushRelayUrl({ SPOONJOY_PUSH_RELAY_URL: "  " })).toBe(DEFAULT_PUSH_RELAY_URL);
    expect(pushRelayUrl({ SPOONJOY_PUSH_RELAY_URL: "https://relay.example/" })).toBe("https://relay.example");
    expect(pushRelayUrl({ SPOONJOY_PUSH_RELAY_URL: "off" })).toBeNull();
    expect(pushRelayUrl({ SPOONJOY_PUSH_RELAY_URL: " Off " })).toBeNull();
  });
});

describe("serverPushRelayKey", () => {
  it("registers the server's address on its first start and keeps the key, readable only by the server", async () => {
    const fetch = relay(201);
    const log = vi.fn();
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await expect(serverPushRelayKey({ file, env: {}, baseUrl: BASE, fetch, log })).resolves.toBe("sjr1.srv1.sig");

    expect(fetch).toHaveBeenCalledWith(`${DEFAULT_PUSH_RELAY_URL}/v1/servers`, expect.objectContaining({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: BASE }),
    }));
    expect(timeout).toHaveBeenCalledWith(REGISTER_TIMEOUT_MS);
    timeout.mockRestore();
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ relayUrl: DEFAULT_PUSH_RELAY_URL, serverId: "srv1", relayKey: "sjr1.srv1.sig" });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(log).toHaveBeenCalledWith("push-relay-registered", { relayUrl: DEFAULT_PUSH_RELAY_URL, serverId: "srv1", turnOff: "SPOONJOY_PUSH_RELAY_URL=off" });

    const again = relay(201);
    await expect(serverPushRelayKey({ file, env: {}, baseUrl: BASE, fetch: again, log })).resolves.toBe("sjr1.srv1.sig");
    expect(again).not.toHaveBeenCalled();
  });

  it("registers again when the owner points the server at another relay, or the saved file is unreadable", async () => {
    await serverPushRelayKey({ file, env: {}, baseUrl: BASE, fetch: relay(201), log: vi.fn() });
    const other = relay(201, { serverId: "srv2", relayKey: "sjr1.srv2.sig" });
    await expect(serverPushRelayKey({ file, env: { SPOONJOY_PUSH_RELAY_URL: "https://relay.example" }, baseUrl: BASE, fetch: other, log: vi.fn() }))
      .resolves.toBe("sjr1.srv2.sig");
    expect(other).toHaveBeenCalledWith("https://relay.example/v1/servers", expect.anything());

    for (const contents of ["not json", "null", JSON.stringify({ relayUrl: DEFAULT_PUSH_RELAY_URL, relayKey: 7 })]) {
      // A file others could read, and a half-written one left by a crash, are both replaced.
      writeFileSync(file, contents, { mode: 0o644 });
      chmodSync(file, 0o644);
      writeFileSync(`${file}.next`, "half");
      const fresh = relay(201);
      await expect(serverPushRelayKey({ file, env: {}, baseUrl: BASE, fetch: fresh, log: vi.fn() })).resolves.toBe("sjr1.srv1.sig");
      expect(fresh).toHaveBeenCalledTimes(1);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(existsSync(`${file}.next`)).toBe(false);
    }
  });

  it("asks the relay for nothing when the owner set their own key or turned the relay off", async () => {
    const fetch = relay(201);
    await expect(serverPushRelayKey({ file, env: { SPOONJOY_PUSH_RELAY_KEY: "sjr1.own.key" }, baseUrl: BASE, fetch, log: vi.fn() })).resolves.toBeNull();
    await expect(serverPushRelayKey({ file, env: { SPOONJOY_PUSH_RELAY_URL: "off" }, baseUrl: BASE, fetch, log: vi.fn() })).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("starts without a key, saving nothing, when the relay refuses, answers oddly or can't be reached", async () => {
    const log = vi.fn();
    await expect(serverPushRelayKey({ file, env: {}, baseUrl: BASE, fetch: relay(429, { error: "rate_limited" }), log })).resolves.toBeNull();
    expect(log).toHaveBeenLastCalledWith("push-relay-register-failed", { relayUrl: DEFAULT_PUSH_RELAY_URL, status: 429 });

    await expect(serverPushRelayKey({ file, env: {}, baseUrl: BASE, fetch: relay(201, { serverId: "srv1" }), log })).resolves.toBeNull();
    expect(log).toHaveBeenLastCalledWith("push-relay-register-failed", { relayUrl: DEFAULT_PUSH_RELAY_URL, error: "TypeError" });

    const offline = vi.fn(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    await expect(serverPushRelayKey({ file, env: {}, baseUrl: BASE, fetch: offline, log })).resolves.toBeNull();
    expect(log).toHaveBeenLastCalledWith("push-relay-register-failed", { relayUrl: DEFAULT_PUSH_RELAY_URL, error: "TimeoutError" });

    const odd = vi.fn(async () => {
      throw null;
    });
    await expect(serverPushRelayKey({ file, env: {}, baseUrl: BASE, fetch: odd, log })).resolves.toBeNull();
    expect(log).toHaveBeenLastCalledWith("push-relay-register-failed", { relayUrl: DEFAULT_PUSH_RELAY_URL, error: "Error" });
    expect(() => statSync(file)).toThrow();
  });
});
