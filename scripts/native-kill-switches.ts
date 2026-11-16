// Switches Spoonjoy Apple app features off (or back on) in production without an app build or a
// Cloudflare login. The Native Kill Switches workflow runs it from main.
//
//   report  reads production's GET /api/v1/native/config and prints which features are off.
//   set     stores SPOONJOY_NATIVE_KILL_SWITCHES (from this process's NATIVE_KILL_SWITCHES: none,
//           a comma-separated list of features, or a JSON object of feature to reason) in one new
//           Worker version tagged with production's source commit, deploys it, then checks that
//           production answers the new switches. A typo, an unknown feature, or a feature production's
//           Worker does not know yet fails before anything changes.
//
// The app stops a switched-off feature within about 15 minutes and starts one switched back on at its
// next launch (docs/deployment.md).
import { canonicalNativeKillSwitches, parseNativeKillSwitches, type NativeKillSwitches } from "~/lib/native-kill-switches.server";
import {
  createWranglerRunner,
  storeProductionSecrets,
  waitMs,
  wranglerEnv,
  type SecretVersionDeps,
  type WranglerRunner,
} from "./production-image-key";

export const NATIVE_KILL_SWITCHES_SECRET = "SPOONJOY_NATIVE_KILL_SWITCHES";
export const PRODUCTION_BASE_URL = "https://spoonjoy.app";
/** How many times set reads production's switches before it gives up on seeing the new ones. */
export const CONFIG_READ_ATTEMPTS = 6;
export const CONFIG_READ_RETRY_MS = 10_000;

export type ConfigFetcher = (url: string) => Promise<Response>;

export interface NativeKillSwitchDeps extends SecretVersionDeps {
  fetchConfig: ConfigFetcher;
  baseUrl: string;
}

export function describeKillSwitches(killSwitches: NativeKillSwitches): string[] {
  const entries = Object.entries(killSwitches);
  if (entries.length === 0) return ["Every native feature is on."];
  return entries.map(([feature, killSwitch]) => `${feature} is off${killSwitch?.reason ? `: ${killSwitch.reason}` : "."}`);
}

export interface ProductionNativeConfig {
  killSwitches: NativeKillSwitches;
  /** The feature names production's Worker knows; it ignores any other. */
  features: string[];
}

export async function readProductionConfig({ fetchConfig, baseUrl }: Pick<NativeKillSwitchDeps, "fetchConfig" | "baseUrl">): Promise<ProductionNativeConfig> {
  // A query string the Worker ignores keeps any cache between here and the Worker from answering.
  const url = `${baseUrl}/api/v1/native/config?fresh=${Date.now()}`;
  const response = await fetchConfig(url);
  if (response.status === 404) {
    throw new Error("Production does not serve GET /api/v1/native/config (404). Release the spoonjoy-v2 version that adds it before setting switches.");
  }
  if (!response.ok) throw new Error(`GET /api/v1/native/config answered ${response.status}.`);
  const body = await response.json() as { data?: { killSwitches?: NativeKillSwitches; features?: unknown } };
  if (!body.data?.killSwitches || typeof body.data.killSwitches !== "object") {
    throw new Error("GET /api/v1/native/config answered without killSwitches.");
  }
  const features = Array.isArray(body.data.features) ? body.data.features.filter((name): name is string => typeof name === "string") : [];
  return { killSwitches: body.data.killSwitches, features };
}

export async function readProductionKillSwitches(deps: Pick<NativeKillSwitchDeps, "fetchConfig" | "baseUrl">): Promise<NativeKillSwitches> {
  return (await readProductionConfig(deps)).killSwitches;
}

export async function report(deps: Pick<NativeKillSwitchDeps, "fetchConfig" | "baseUrl" | "log">): Promise<NativeKillSwitches> {
  const killSwitches = await readProductionKillSwitches(deps);
  deps.log(`Production's native kill switches (${deps.baseUrl}/api/v1/native/config):`);
  for (const line of describeKillSwitches(killSwitches)) deps.log(`  ${line}`);
  return killSwitches;
}

export async function setKillSwitches(deps: NativeKillSwitchDeps, input: string | undefined): Promise<NativeKillSwitches> {
  // Validate before touching production: a typo must never become a stored value that switches nothing off.
  const value = canonicalNativeKillSwitches(input ?? "");
  const expected = parseNativeKillSwitches(value).killSwitches;
  // Production may run an older Worker than this script; it would ignore a feature it does not know.
  const { features } = await readProductionConfig(deps);
  const unknown = Object.keys(expected).filter((name) => !features.includes(name));
  if (unknown.length > 0) {
    throw new Error(`Production does not know ${unknown.join(", ")}; it knows ${features.join(", ") || "no features"}. Release the spoonjoy-v2 version that adds it first.`);
  }
  deps.log(`Setting ${NATIVE_KILL_SWITCHES_SECRET} to ${value}.`);
  await storeProductionSecrets(deps, { [NATIVE_KILL_SWITCHES_SECRET]: value });

  for (let attempt = 1; ; attempt += 1) {
    const served = await readProductionKillSwitches(deps);
    if (JSON.stringify(served) === JSON.stringify(expected)) {
      deps.log("Production now answers:");
      for (const line of describeKillSwitches(served)) deps.log(`  ${line}`);
      return served;
    }
    if (attempt === CONFIG_READ_ATTEMPTS) {
      throw new Error(`Production still answers ${JSON.stringify(served)} instead of ${JSON.stringify(expected)}.`);
    }
    await deps.sleep(CONFIG_READ_RETRY_MS);
  }
}

export async function main(
  argv: readonly string[],
  {
    env = process.env,
    run = createWranglerRunner(),
    log = console.log,
    sleep = waitMs,
    fetchConfig = (url: string) => fetch(url, { headers: { "Cache-Control": "no-cache" } }),
  }: {
    env?: NodeJS.ProcessEnv;
    run?: WranglerRunner;
    log?: (line: string) => void;
    sleep?: (ms: number) => Promise<void>;
    fetchConfig?: ConfigFetcher;
  } = {},
): Promise<void> {
  const [command] = argv;
  const baseUrl = PRODUCTION_BASE_URL;
  if (command === "report") {
    await report({ fetchConfig, baseUrl, log });
    return;
  }
  if (command !== "set") {
    throw new Error("Usage: native-kill-switches.ts <report|set>");
  }
  await setKillSwitches(
    { run, workersEnv: wranglerEnv(env, "CLOUDFLARE_WORKERS_API_TOKEN"), log, sleep, fetchConfig, baseUrl },
    env.NATIVE_KILL_SWITCHES,
  );
}

/* istanbul ignore if -- @preserve the CLI boundary delegates to the tested main above. */
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
