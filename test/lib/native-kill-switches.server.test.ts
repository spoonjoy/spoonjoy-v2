import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NATIVE_FEATURES,
  NATIVE_KILL_SWITCH_REASON_MAX_LENGTH,
  canonicalNativeKillSwitches,
  nativeConfigData,
  parseNativeKillSwitches,
} from "~/lib/native-kill-switches.server";

describe("native kill switch features", () => {
  it("names the feature paths the Spoonjoy Apple app honours, in a stable order", () => {
    expect(NATIVE_FEATURES).toEqual(["cook-session-sync", "spotlight-indexing"]);
  });
});

describe("parseNativeKillSwitches", () => {
  it("turns nothing off when the variable is unset, empty or none", () => {
    for (const raw of [undefined, null, "", "   ", "none", " NONE "]) {
      expect(parseNativeKillSwitches(raw)).toEqual({ killSwitches: {}, ignored: [], valid: true });
    }
  });

  it("reads a comma or whitespace separated list of feature names, without reasons", () => {
    expect(parseNativeKillSwitches(" spotlight-indexing, cook-session-sync\nspotlight-indexing ")).toEqual({
      killSwitches: {
        "cook-session-sync": { off: true, reason: null },
        "spotlight-indexing": { off: true, reason: null },
      },
      ignored: [],
      valid: true,
    });
  });

  it("ignores names it does not know, and keeps the ones it does", () => {
    expect(parseNativeKillSwitches("cook-session-sync,spotlight,COOK-SESSION-SYNC")).toEqual({
      killSwitches: { "cook-session-sync": { off: true, reason: null } },
      ignored: ["spotlight", "COOK-SESSION-SYNC"],
      valid: true,
    });
  });

  it("reads a JSON object whose values are a reason, true, or the response's own shape", () => {
    const raw = JSON.stringify({
      "cook-session-sync": "  Crashes cook mode on 1.2  ",
      "spotlight-indexing": true,
    });
    expect(parseNativeKillSwitches(raw)).toEqual({
      killSwitches: {
        "cook-session-sync": { off: true, reason: "Crashes cook mode on 1.2" },
        "spotlight-indexing": { off: true, reason: null },
      },
      ignored: [],
      valid: true,
    });
    expect(parseNativeKillSwitches(JSON.stringify({
      "cook-session-sync": { off: true, reason: "Server work" },
      "spotlight-indexing": { off: false, reason: "Back on" },
    }))).toEqual({
      killSwitches: { "cook-session-sync": { off: true, reason: "Server work" } },
      ignored: [],
      valid: true,
    });
  });

  it("treats an empty reason as no reason and cuts a long one", () => {
    const long = "x".repeat(NATIVE_KILL_SWITCH_REASON_MAX_LENGTH + 20);
    expect(parseNativeKillSwitches(JSON.stringify({ "cook-session-sync": "   ", "spotlight-indexing": { off: true, reason: long } }))).toEqual({
      killSwitches: {
        "cook-session-sync": { off: true, reason: null },
        "spotlight-indexing": { off: true, reason: "x".repeat(NATIVE_KILL_SWITCH_REASON_MAX_LENGTH) },
      },
      ignored: [],
      valid: true,
    });
    expect(parseNativeKillSwitches(JSON.stringify({ "cook-session-sync": { off: true, reason: 7 } })).killSwitches)
      .toEqual({ "cook-session-sync": { off: true, reason: null } });
  });

  it("ignores JSON entries for unknown features or with values it cannot read", () => {
    expect(parseNativeKillSwitches(JSON.stringify({
      "cook-session-sync": false,
      "spotlight-indexing": 1,
      tabs: true,
    }))).toEqual({ killSwitches: {}, ignored: ["spotlight-indexing", "tabs"], valid: true });
    expect(parseNativeKillSwitches(JSON.stringify({ "cook-session-sync": null, "spotlight-indexing": { off: "yes" } })))
      .toEqual({ killSwitches: {}, ignored: ["cook-session-sync", "spotlight-indexing"], valid: true });
  });

  it("fails open, turning nothing off, when the JSON is garbled or not an object", () => {
    for (const raw of ["{not json", "{\"cook-session-sync\": tru}", "{", "[\"cook-session-sync\"]", "[]"]) {
      expect(parseNativeKillSwitches(raw)).toEqual({ killSwitches: {}, ignored: [], valid: false });
    }
  });
});

describe("canonicalNativeKillSwitches", () => {
  it("stores none when nothing is off", () => {
    expect(canonicalNativeKillSwitches("")).toBe("none");
    expect(canonicalNativeKillSwitches("none")).toBe("none");
  });

  it("stores a JSON object in feature order, with reasons", () => {
    expect(canonicalNativeKillSwitches("spotlight-indexing, cook-session-sync")).toBe(
      "{\"cook-session-sync\":{\"off\":true,\"reason\":null},\"spotlight-indexing\":{\"off\":true,\"reason\":null}}",
    );
    expect(canonicalNativeKillSwitches("{\"cook-session-sync\":\"Durable Object outage\"}")).toBe(
      "{\"cook-session-sync\":{\"off\":true,\"reason\":\"Durable Object outage\"}}",
    );
  });

  it("refuses a value it cannot read or a name it does not know, so a typo is never stored", () => {
    expect(() => canonicalNativeKillSwitches("{oops")).toThrow(
      "SPOONJOY_NATIVE_KILL_SWITCHES must be none, a comma-separated list of features, or a JSON object.",
    );
    expect(() => canonicalNativeKillSwitches("cook-session-sync,spotlight")).toThrow(
      "Unknown or unreadable native kill switches: spotlight. Known features: cook-session-sync, spotlight-indexing.",
    );
  });

  it("refuses a reason that reads as on or off, so a typo never switches a feature off", () => {
    for (const word of ["on", "off", "true", "false", "yes", "no", "enabled", "disabled", "FALSE", " Off ", "Disabled"]) {
      expect(() => canonicalNativeKillSwitches(JSON.stringify({ "cook-session-sync": word }))).toThrow(
        "A reason reads as on or off for: cook-session-sync.",
      );
      expect(() => canonicalNativeKillSwitches(JSON.stringify({ "spotlight-indexing": { off: true, reason: word } }))).toThrow(
        "A reason reads as on or off for: spotlight-indexing.",
      );
    }
    // Reasons that merely contain such a word, and the JSON booleans themselves, are fine.
    expect(canonicalNativeKillSwitches(JSON.stringify({ "cook-session-sync": "Turned off for repairs", "spotlight-indexing": true })))
      .toBe("{\"cook-session-sync\":{\"off\":true,\"reason\":\"Turned off for repairs\"},\"spotlight-indexing\":{\"off\":true,\"reason\":null}}");
    expect(canonicalNativeKillSwitches(JSON.stringify({ "cook-session-sync": false, "spotlight-indexing": { off: false, reason: null } }))).toBe("none");
  });
});

describe("nativeConfigData", () => {
  it("answers everything on without an environment", () => {
    expect(nativeConfigData(undefined)).toEqual({ killSwitches: {}, features: ["cook-session-sync", "spotlight-indexing"] });
    expect(nativeConfigData(null)).toEqual({ killSwitches: {}, features: ["cook-session-sync", "spotlight-indexing"] });
  });

  it("answers the switches the environment turns off", () => {
    expect(nativeConfigData({ SPOONJOY_NATIVE_KILL_SWITCHES: "{\"spotlight-indexing\":\"Indexing crash\"}" })).toEqual({
      killSwitches: { "spotlight-indexing": { off: true, reason: "Indexing crash" } },
      features: ["cook-session-sync", "spotlight-indexing"],
    });
  });

  it("answers everything on when the variable is garbled", () => {
    expect(nativeConfigData({ SPOONJOY_NATIVE_KILL_SWITCHES: "{\"cook-session-sync\":" }).killSwitches).toEqual({});
  });
});

describe("nativeConfigData reports a value it cannot read", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubPostHog() {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const tasks: Promise<unknown>[] = [];
    return { fetchMock, tasks, waitUntil: (promise: Promise<unknown>) => tasks.push(promise) };
  }

  const posthog = { POSTHOG_KEY: "phc_test", POSTHOG_HOST: "https://posthog.test" };

  it("sends an unreadable event, with counts only, for a garbled value or an unknown feature", async () => {
    for (const [raw, expected] of [
      ["{\"cook-session-sync\":", { unparseable: true, ignored_count: 0, switched_off_count: 0 }],
      ["cook-session-sync, spotlight-index", { unparseable: false, ignored_count: 1, switched_off_count: 1 }],
    ] as const) {
      const { fetchMock, tasks, waitUntil } = stubPostHog();
      nativeConfigData({ ...posthog, SPOONJOY_NATIVE_KILL_SWITCHES: raw }, waitUntil);
      await Promise.all(tasks);
      expect(tasks).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
      expect(body.event).toBe("spoonjoy.native_kill_switches.unreadable");
      expect(body.properties).toMatchObject(expected);
      expect(JSON.stringify(body)).not.toContain("spotlight-index\"");
    }
  });

  it("sends nothing for a readable value, and never throws without waitUntil", async () => {
    const { fetchMock, tasks, waitUntil } = stubPostHog();
    nativeConfigData({ ...posthog, SPOONJOY_NATIVE_KILL_SWITCHES: "spotlight-indexing" }, waitUntil);
    nativeConfigData({ ...posthog, SPOONJOY_NATIVE_KILL_SWITCHES: "none" }, waitUntil);
    expect(tasks).toHaveLength(0);
    expect(() => nativeConfigData({ ...posthog, SPOONJOY_NATIVE_KILL_SWITCHES: "[" })).not.toThrow();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
