import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RELAY_URL,
  main,
  PRODUCTION_BASE_URL,
  registerWithRelay,
  RELAY_KEY_SECRET,
} from "../../scripts/production-push-relay-key";
import type { WranglerRunner } from "../../scripts/production-image-key";

const ACTIVE = "11111111-1111-4111-8111-111111111111";
const KEY_VERSION = "22222222-2222-4222-8222-222222222222";
const SOURCE_SHA = "a".repeat(40);
const RELAY_KEY = "sjr1.serverid.signature";
const ENV = { CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_WORKERS_API_TOKEN: "workers-token", PATH: "/usr/bin" };

/** Production's Worker as wrangler sees it: one running version, which gains the key once deployed. */
function fakeWrangler({ hasKey = false } = {}) {
  let deployed = false;
  let made = false;
  const calls: Array<{ args: readonly string[]; env: NodeJS.ProcessEnv; input?: string }> = [];
  const version = (id: string, day: number) => ({ id, metadata: { created_on: `2026-10-0${day}T00:00:00Z` } });
  const run: WranglerRunner = async (args, { env, input }) => {
    calls.push({ args, env, input });
    const command = args.slice(0, 3).join(" ");
    if (command.startsWith("secret list")) {
      return JSON.stringify([{ name: "SESSION_SECRET" }, ...(hasKey || deployed ? [{ name: RELAY_KEY_SECRET }] : [])]);
    }
    if (command.startsWith("deployments list")) {
      return JSON.stringify([
        { id: "44444444-4444-4444-8444-444444444444", created_on: "2026-10-01T00:00:00Z", versions: [{ version_id: ACTIVE, percentage: 100 }] },
        ...(deployed
          ? [{ id: "55555555-5555-4555-8555-555555555555", created_on: "2026-10-02T00:00:00Z", versions: [{ version_id: KEY_VERSION, percentage: 100 }] }]
          : []),
      ]);
    }
    if (command.startsWith("versions list")) return JSON.stringify([version(ACTIVE, 1), ...(made ? [version(KEY_VERSION, 2)] : [])]);
    if (command.startsWith("versions view")) {
      return JSON.stringify({ id: args[2], number: 7, annotations: { "workers/tag": SOURCE_SHA }, metadata: { created_on: "2026-10-01T00:00:00Z", source: "wrangler" } });
    }
    if (command === "versions secret bulk") {
      made = true;
      return `Created version ${KEY_VERSION} with 1 secret.`;
    }
    if (command.startsWith("versions deploy")) {
      deployed = true;
      return "Deployed";
    }
    throw new Error(`unexpected wrangler ${args.join(" ")}`);
  };
  return { run, calls };
}

function relay(status: number, body: unknown) {
  return vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("scripts/production-push-relay-key", () => {
  it("registers spoonjoy.app with the relay and stores its key in a tagged production version, never printing it", async () => {
    const { run, calls } = fakeWrangler();
    const fetch = relay(201, { serverId: "serverid", relayKey: RELAY_KEY });
    const log = vi.fn();

    await main({ run, fetch, env: ENV, log, sleep: vi.fn(async () => undefined) });

    expect(fetch).toHaveBeenCalledWith(`${DEFAULT_RELAY_URL}/v1/servers`, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ baseUrl: PRODUCTION_BASE_URL }),
    }));
    const bulk = calls.find((call) => call.args.join(" ").startsWith("versions secret bulk"));
    expect(bulk?.args).toEqual(["versions", "secret", "bulk", "--tag", SOURCE_SHA]);
    expect(JSON.parse(bulk?.input ?? "{}")).toEqual({ [RELAY_KEY_SECRET]: RELAY_KEY });
    expect(calls.every((call) => call.env.CLOUDFLARE_API_TOKEN === "workers-token")).toBe(true);
    expect(calls.some((call) => call.args.join(" ") === `versions deploy ${KEY_VERSION}@100% -y`)).toBe(true);
    const printed = log.mock.calls.map(([line]) => String(line)).join("\n");
    expect(printed).toContain("as server serverid");
    expect(printed).not.toContain(RELAY_KEY);
  });

  it("does nothing when production has the key already", async () => {
    const { run, calls } = fakeWrangler({ hasKey: true });
    const fetch = relay(201, { serverId: "serverid", relayKey: RELAY_KEY });
    const log = vi.fn();

    await main({ run, fetch, env: ENV, log });

    expect(fetch).not.toHaveBeenCalled();
    expect(calls.map((call) => call.args.slice(0, 2).join(" "))).toEqual(["secret list"]);
    expect(log).toHaveBeenCalledWith(`Production has ${RELAY_KEY_SECRET} already; nothing to do.`);
  });

  it("registers with another relay when one is named", async () => {
    const { run } = fakeWrangler();
    const fetch = relay(201, { serverId: "serverid", relayKey: RELAY_KEY });
    await main({ run, fetch, env: { ...ENV, SPOONJOY_PUSH_RELAY_URL: "https://relay.example/" }, log: vi.fn(), sleep: vi.fn(async () => undefined) });
    expect(fetch).toHaveBeenCalledWith("https://relay.example/v1/servers", expect.anything());
  });

  it("refuses, registering nothing, when the relay is turned off", async () => {
    const { run } = fakeWrangler();
    const fetch = relay(201, { serverId: "serverid", relayKey: RELAY_KEY });
    await expect(main({ run, fetch, env: { ...ENV, SPOONJOY_PUSH_RELAY_URL: "Off" }, log: vi.fn(), sleep: vi.fn(async () => undefined) }))
      .rejects.toThrow("SPOONJOY_PUSH_RELAY_URL is off, so production has no relay to register with.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stores nothing when the relay refuses or answers without a key", async () => {
    await expect(registerWithRelay(DEFAULT_RELAY_URL, PRODUCTION_BASE_URL, relay(503, { error: "not_configured" })))
      .rejects.toThrow("The push relay refused to register https://spoonjoy.app: 503 not_configured.");
    await expect(registerWithRelay(DEFAULT_RELAY_URL, PRODUCTION_BASE_URL, relay(201, { serverId: "serverid" })))
      .rejects.toThrow("201 without a relay key.");
    await expect(registerWithRelay(DEFAULT_RELAY_URL, PRODUCTION_BASE_URL, relay(201, { relayKey: RELAY_KEY })))
      .rejects.toThrow("201 without a relay key.");
    await expect(registerWithRelay(DEFAULT_RELAY_URL, PRODUCTION_BASE_URL, relay(502, "Bad gateway")))
      .rejects.toThrow("502 without a relay key.");

    const { run, calls } = fakeWrangler();
    await expect(main({ run, fetch: relay(429, { error: "rate_limited" }), env: ENV, log: vi.fn() })).rejects.toThrow("429 rate_limited");
    expect(calls.some((call) => call.args[0] === "versions")).toBe(false);
  });

  it("names the registered server to revoke when its key could not be stored", async () => {
    const { run: base } = fakeWrangler();
    const run: WranglerRunner = async (args, options) => {
      if (args.slice(0, 2).join(" ") === "versions list") throw new Error("versions list failed");
      return base(args, options);
    };
    const log = vi.fn();
    await expect(main({ run, fetch: relay(201, { serverId: "serverid", relayKey: RELAY_KEY }), env: ENV, log })).rejects.toThrow("versions list failed");
    expect(log).toHaveBeenLastCalledWith("Storing server serverid's key stopped part way (the error says where). If the version production runs lacks SPOONJOY_PUSH_RELAY_KEY, add serverid to the relay's REVOKED_SERVER_IDS, delete any stored SPOONJOY_PUSH_RELAY_KEY and run this workflow again.");
  });

  it("needs the Workers token", async () => {
    const { run } = fakeWrangler();
    await expect(main({ run, fetch: relay(201, {}), env: { CLOUDFLARE_ACCOUNT_ID: "account" } }))
      .rejects.toThrow("CLOUDFLARE_WORKERS_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required.");
  });
});
