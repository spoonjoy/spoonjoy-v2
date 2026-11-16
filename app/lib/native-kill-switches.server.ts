// Server kill switches for named feature paths in the Spoonjoy Apple app (spoonjoy/spoonjoy-apple).
//
// The app reads GET /api/v1/native/config in the background at launch and in the foreground, keeps the
// last good answer, and leaves each feature that is off alone. An operator turns a feature off by
// setting the Worker secret SPOONJOY_NATIVE_KILL_SWITCHES (docs/deployment.md, "Native kill switches"),
// so no app build or App Review is needed.
//
// The value is read on every request. Anything this file cannot read turns nothing off: a garbled value
// must never switch the app's features off by accident.
//
// The feature names are shared with spoonjoy-apple's NativeFeature enum; add a name on both sides.
//
// A stored value the Worker cannot fully read (garbled, or naming an unknown feature) is reported as the
// spoonjoy.native_kill_switches.unreadable event, so an operator learns that a switch they meant to set is
// not in effect.

import { captureEvent, resolvePostHogServerConfig, type PostHogServerEnv } from "~/lib/analytics-server";

export const NATIVE_FEATURES = [
  /** Cross-device cook progress: the app's exchange with /api/cook-sessions. */
  "cook-session-sync",
  /** The app's Spotlight and App Entity index refresh. */
  "spotlight-indexing",
] as const;

export type NativeFeature = (typeof NATIVE_FEATURES)[number];

export type NativeKillSwitch = { off: true; reason: string | null };

export type NativeKillSwitches = Partial<Record<NativeFeature, NativeKillSwitch>>;

export type NativeKillSwitchEnv = ({ SPOONJOY_NATIVE_KILL_SWITCHES?: string } & PostHogServerEnv) | null | undefined;

export const NATIVE_KILL_SWITCH_REASON_MAX_LENGTH = 200;

export type ParsedNativeKillSwitches = {
  killSwitches: NativeKillSwitches;
  /** Names or entries that were skipped: unknown features, or JSON values this file cannot read. */
  ignored: string[];
  /** False when the value is JSON that cannot be read as an object; nothing is off then. */
  valid: boolean;
};

function isNativeFeature(name: string): name is NativeFeature {
  return (NATIVE_FEATURES as readonly string[]).includes(name);
}

function reasonFrom(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.trim().slice(0, NATIVE_KILL_SWITCH_REASON_MAX_LENGTH);
  return reason === "" ? null : reason;
}

/** The switch an entry of the JSON form turns on, null for an entry that leaves the feature on, or undefined when unreadable. */
function switchFromJsonValue(value: unknown): NativeKillSwitch | null | undefined {
  if (value === true) return { off: true, reason: null };
  if (value === false) return null;
  if (typeof value === "string") return { off: true, reason: reasonFrom(value) };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const { off, reason } = value as { off?: unknown; reason?: unknown };
    if (off === true) return { off: true, reason: reasonFrom(reason) };
    if (off === false) return null;
  }
  return undefined;
}

function inFeatureOrder(switches: Map<NativeFeature, NativeKillSwitch>): NativeKillSwitches {
  const ordered: NativeKillSwitches = {};
  for (const feature of NATIVE_FEATURES) {
    const killSwitch = switches.get(feature);
    if (killSwitch) ordered[feature] = killSwitch;
  }
  return ordered;
}

/**
 * Reads SPOONJOY_NATIVE_KILL_SWITCHES: `none` (or unset), a comma or whitespace separated list of feature
 * names, or a JSON object from feature name to a reason string, `true`, or `{ "off": true, "reason": "..." }`.
 */
export function parseNativeKillSwitches(raw: string | null | undefined): ParsedNativeKillSwitches {
  const text = raw?.trim() ?? "";
  const switches = new Map<NativeFeature, NativeKillSwitch>();
  const ignored: string[] = [];
  if (text === "" || text.toLowerCase() === "none") {
    return { killSwitches: {}, ignored, valid: true };
  }

  if (text.startsWith("{") || text.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { killSwitches: {}, ignored, valid: false };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { killSwitches: {}, ignored, valid: false };
    }
    for (const [name, value] of Object.entries(parsed)) {
      const killSwitch = switchFromJsonValue(value);
      if (!isNativeFeature(name) || killSwitch === undefined) {
        ignored.push(name);
      } else if (killSwitch) {
        switches.set(name, killSwitch);
      }
    }
    return { killSwitches: inFeatureOrder(switches), ignored, valid: true };
  }

  for (const name of text.split(/[\s,]+/).filter(Boolean)) {
    if (isNativeFeature(name)) {
      switches.set(name, { off: true, reason: null });
    } else {
      ignored.push(name);
    }
  }
  return { killSwitches: inFeatureOrder(switches), ignored, valid: true };
}

/** A reason that reads as on or off, which an operator may have meant as the switch itself. */
const BOOLEAN_LIKE_REASON = /^(on|off|true|false|yes|no|enabled|disabled)$/i;

/** The JSON form's entries whose reason reads as on or off, such as {"cook-session-sync":"false"}. */
function booleanLikeReasons(text: string): string[] {
  if (!text.startsWith("{")) return [];
  const names: string[] = [];
  for (const [name, value] of Object.entries(JSON.parse(text) as Record<string, unknown>)) {
    const reason = typeof value === "string" ? value : (value as { reason?: unknown }).reason;
    if (typeof reason === "string" && BOOLEAN_LIKE_REASON.test(reason.trim())) names.push(name);
  }
  return names;
}

/**
 * The value to store for an operator's input, refusing anything the Worker would ignore, so a typo fails
 * loudly when it is set instead of silently leaving a feature on. A reason that reads as on or off
 * ({"cook-session-sync":"false"}) is refused too: the Worker would read it as a reason and switch the feature off.
 */
export function canonicalNativeKillSwitches(input: string): string {
  const parsed = parseNativeKillSwitches(input);
  if (!parsed.valid) {
    throw new Error("SPOONJOY_NATIVE_KILL_SWITCHES must be none, a comma-separated list of features, or a JSON object.");
  }
  if (parsed.ignored.length > 0) {
    throw new Error(
      `Unknown or unreadable native kill switches: ${parsed.ignored.join(", ")}. Known features: ${NATIVE_FEATURES.join(", ")}.`,
    );
  }
  const booleanLike = booleanLikeReasons(input.trim());
  if (booleanLike.length > 0) {
    throw new Error(
      `A reason reads as on or off for: ${booleanLike.join(", ")}. Give a reason in words, true to switch a feature off, or leave the feature out to keep it on.`,
    );
  }
  return Object.keys(parsed.killSwitches).length === 0 ? "none" : JSON.stringify(parsed.killSwitches);
}

/**
 * The data of GET /api/v1/native/config. A stored value it cannot fully read is reported (never thrown); pass the
 * request's waitUntil so the report outlives the response.
 */
export function nativeConfigData(env: NativeKillSwitchEnv, waitUntil?: (promise: Promise<unknown>) => void) {
  const parsed = parseNativeKillSwitches(env?.SPOONJOY_NATIVE_KILL_SWITCHES);
  if (env && (!parsed.valid || parsed.ignored.length > 0)) {
    const task = captureEvent(resolvePostHogServerConfig(env), {
      event: "spoonjoy.native_kill_switches.unreadable",
      distinctId: "server",
      properties: {
        unparseable: !parsed.valid,
        ignored_count: parsed.ignored.length,
        switched_off_count: Object.keys(parsed.killSwitches).length,
      },
    });
    if (waitUntil) waitUntil(task);
  }
  return {
    killSwitches: parsed.killSwitches,
    features: [...NATIVE_FEATURES],
  };
}
