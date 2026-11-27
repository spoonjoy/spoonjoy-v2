// Gives production its push relay key (docs/push-relay.md), so spoonjoy.app's notifications reach
// the Spoonjoy iPhone, iPad and Mac app. The Production Push Relay Key workflow runs it from main.
//
// It registers https://spoonjoy.app with the relay and stores the key it gets back as the Worker
// secret SPOONJOY_PUSH_RELAY_KEY, in one new version of the code production runs, tagged with its
// source commit (storeProductionSecrets), so the next Production Deploy accepts it. The key goes to
// wrangler on stdin and is never printed. When production has the secret already it does nothing:
// to replace the key, delete the secret first.
import {
  createWranglerRunner,
  secretNames,
  storeProductionSecrets,
  waitMs,
  wranglerEnv,
  type WranglerRunner,
} from "./production-image-key";

export const PRODUCTION_BASE_URL = "https://spoonjoy.app";
// The relay's address, RELAY_URL in workers/push-relay/index.ts (a test pins every copy to it).
export const DEFAULT_RELAY_URL = "https://spoonjoy-push-relay.mendelow-studio.workers.dev";
export const RELAY_KEY_SECRET = "SPOONJOY_PUSH_RELAY_KEY";
export const REGISTER_TIMEOUT_MS = 10_000;

export interface RelayKeyDeps {
  run: WranglerRunner;
  fetch: typeof fetch;
  env: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

/** Registers `baseUrl` with the relay and returns the server id and relay key it answers with. */
export async function registerWithRelay(relayUrl: string, baseUrl: string, fetchImpl: typeof fetch): Promise<{ serverId: string; relayKey: string }> {
  const response = await fetchImpl(`${relayUrl}/v1/servers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseUrl }),
    signal: AbortSignal.timeout(REGISTER_TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => null)) as { serverId?: unknown; relayKey?: unknown; error?: unknown } | null;
  if (response.status !== 201 || typeof body?.serverId !== "string" || typeof body.relayKey !== "string") {
    throw new Error(`The push relay refused to register ${baseUrl}: ${response.status} ${typeof body?.error === "string" ? body.error : "without a relay key"}.`);
  }
  return { serverId: body.serverId, relayKey: body.relayKey };
}

export async function main({ run, fetch: fetchImpl, env, log = console.log, sleep = waitMs }: RelayKeyDeps): Promise<void> {
  const workersEnv = wranglerEnv(env, "CLOUDFLARE_WORKERS_API_TOKEN");
  if (secretNames(await run(["secret", "list", "--format", "json"], { env: workersEnv })).includes(RELAY_KEY_SECRET)) {
    log(`Production has ${RELAY_KEY_SECRET} already; nothing to do.`);
    return;
  }
  const relayUrl = (env.SPOONJOY_PUSH_RELAY_URL?.trim() || DEFAULT_RELAY_URL).replace(/\/+$/, "");
  if (relayUrl.toLowerCase() === "off") throw new Error("SPOONJOY_PUSH_RELAY_URL is off, so production has no relay to register with.");
  const { serverId, relayKey } = await registerWithRelay(relayUrl, PRODUCTION_BASE_URL, fetchImpl);
  log(`Registered ${PRODUCTION_BASE_URL} with ${relayUrl} as server ${serverId}.`);
  try {
    await storeProductionSecrets({ run, workersEnv, log, sleep }, { [RELAY_KEY_SECRET]: relayKey });
  } catch (error) {
    // Storing can stop before the secret is uploaded, after it is in a version not yet deployed, or
    // after the deploy: say what to check, and the id to revoke if the key is not what production runs.
    log(
      `Storing server ${serverId}'s key stopped part way (the error says where). If the version production runs lacks ${RELAY_KEY_SECRET}, add ${serverId} to the relay's REVOKED_SERVER_IDS, delete any stored ${RELAY_KEY_SECRET} and run this workflow again.`,
    );
    throw error;
  }
}

/* istanbul ignore if -- @preserve the CLI boundary delegates to the tested main above. */
if (import.meta.url === `file://${process.argv[1]}`) {
  main({ run: createWranglerRunner(), fetch: globalThis.fetch, env: process.env }).catch((error) => {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
