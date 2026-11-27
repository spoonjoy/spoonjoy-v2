// Each self-hosted server's own key for the push relay (docs/push-relay.md), which sends the Spoonjoy
// iPhone, iPad and Mac app's notifications through Apple for it. The server registers itself on its
// first start and keeps the key in the data folder, so the key survives restarts and updates. The app
// reads it as SPOONJOY_PUSH_RELAY_KEY (app/lib/native-push.server.ts), unless the owner sets that
// themselves; SPOONJOY_PUSH_RELAY_URL=off keeps the server from contacting the relay at all.
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

// The relay's address, RELAY_URL in workers/push-relay/index.ts (a test pins every copy to it).
export const DEFAULT_PUSH_RELAY_URL = "https://spoonjoy-push-relay.mendelow-studio.workers.dev";
export const REGISTER_TIMEOUT_MS = 5_000;

/** The relay's address from SPOONJOY_PUSH_RELAY_URL, or null when the owner turned it off. */
export function pushRelayUrl(env) {
  const url = env.SPOONJOY_PUSH_RELAY_URL?.trim() || DEFAULT_PUSH_RELAY_URL;
  return url.toLowerCase() === "off" ? null : url.replace(/\/+$/, "");
}

/** The key saved in `file` for `relayUrl`, or null when there is none for that relay. */
function savedKey(file, relayUrl) {
  if (!existsSync(file)) return null;
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    return saved?.relayUrl === relayUrl && typeof saved.relayKey === "string" ? saved.relayKey : null;
  } catch {
    return null;
  }
}

/**
 * The server's relay key from `file`, registering `baseUrl` with the relay and saving the key
 * (readable only by the server) the first time, or when the owner points the server at another
 * relay. Null, and nothing saved, when the owner set their own key or turned the relay off, or
 * when the relay can't be reached or refuses: then the next start tries again, and until then
 * notifications go to browsers only.
 */
export async function serverPushRelayKey({ file, env, baseUrl, fetch, log }) {
  if (env.SPOONJOY_PUSH_RELAY_KEY?.trim()) return null;
  const relayUrl = pushRelayUrl(env);
  if (!relayUrl) return null;
  const saved = savedKey(file, relayUrl);
  if (saved) return saved;
  try {
    const response = await fetch(`${relayUrl}/v1/servers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl }),
      signal: AbortSignal.timeout(REGISTER_TIMEOUT_MS),
    });
    if (response.status !== 201) {
      log("push-relay-register-failed", { relayUrl, status: response.status });
      return null;
    }
    const { serverId, relayKey } = await response.json();
    if (typeof relayKey !== "string") throw new TypeError("The relay answered without a relay key.");
    // Written beside the file, readable only by the server from the start, then moved into place, so
    // the key is never in a file others can read, nor in a half-written one.
    const next = `${file}.next`;
    rmSync(next, { force: true });
    writeFileSync(next, JSON.stringify({ relayUrl, serverId, relayKey }), { mode: 0o600 });
    renameSync(next, file);
    // Said once, on the start that registers: which relay, and how to stop the server contacting it.
    log("push-relay-registered", { relayUrl, serverId, turnOff: "SPOONJOY_PUSH_RELAY_URL=off" });
    return relayKey;
  } catch (error) {
    log("push-relay-register-failed", { relayUrl, error: error?.name ?? "Error" });
    return null;
  }
}
