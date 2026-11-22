import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTestRoutesStub } from "../../utils";
import { FLAG_NAMES, flagsFor, isFlagOn, resolveFlags, useFlag, type FlagName } from "~/domains/platform";

const KNOWN = ["meal-planner", "households", "move-in"] as const;

describe("feature flags", () => {
  it("are all off when the environment names none, as in production", () => {
    expect(resolveFlags(KNOWN, {}, "user-1")).toEqual([]);
    expect(resolveFlags(KNOWN, null, null)).toEqual([]);
    expect(resolveFlags(KNOWN, undefined, undefined)).toEqual([]);
    expect(resolveFlags(KNOWN, { SPOONJOY_FLAGS: "  " }, "user-1")).toEqual([]);
  });

  it("are all on for everyone when SPOONJOY_FLAGS is all, as in QA", () => {
    expect(resolveFlags(KNOWN, { SPOONJOY_FLAGS: "all" }, null)).toEqual(["households", "meal-planner", "move-in"]);
    expect(resolveFlags(KNOWN, { SPOONJOY_FLAGS: " ALL " }, "user-1")).toEqual(["households", "meal-planner", "move-in"]);
  });

  it("turn on the flags SPOONJOY_FLAGS names, and ignore names nobody declared", () => {
    expect(resolveFlags(KNOWN, { SPOONJOY_FLAGS: "move-in, meal-planner unknown-flag" }, null)).toEqual(["meal-planner", "move-in"]);
  });

  it("turn on per user from SPOONJOY_FLAG_USERS, for dogfooding", () => {
    const env = { SPOONJOY_FLAG_USERS: JSON.stringify({ "user-1": ["households", "nope"], "user-2": "all" }) };
    expect(resolveFlags(KNOWN, env, "user-1")).toEqual(["households"]);
    expect(resolveFlags(KNOWN, env, "user-2")).toEqual(["households", "meal-planner", "move-in"]);
    expect(resolveFlags(KNOWN, env, "user-3")).toEqual([]);
    expect(resolveFlags(KNOWN, env, null)).toEqual([]);
    expect(resolveFlags(KNOWN, { ...env, SPOONJOY_FLAGS: "move-in" }, "user-1")).toEqual(["households", "move-in"]);
  });

  it("turn nothing on from a per-user value they cannot read", () => {
    for (const value of ["{not json", "[]", "null", '"all"', JSON.stringify({ "user-1": 7 }), JSON.stringify({ "user-1": [3, "move-in"] })]) {
      const expected = value.includes("move-in") ? ["move-in"] : [];
      expect(resolveFlags(KNOWN, { SPOONJOY_FLAG_USERS: value }, "user-1")).toEqual(expected);
    }
  });

  it("bind the declared flag names for the app, on the server", () => {
    expect([...FLAG_NAMES].sort()).toEqual([...FLAG_NAMES]);
    expect(flagsFor({ SPOONJOY_FLAGS: "all" }, null)).toEqual([...FLAG_NAMES]);
    expect(flagsFor({}, "user-1")).toEqual([]);
    for (const name of FLAG_NAMES) {
      expect(isFlagOn(name, { SPOONJOY_FLAGS: "all" }, null)).toBe(true);
      expect(isFlagOn(name, {}, null)).toBe(false);
    }
    expect(isFlagOn("not-declared" as FlagName, { SPOONJOY_FLAGS: "all" }, null)).toBe(false);
  });

  it("are readable on the client from the root loader's flags", async () => {
    function Probe() {
      return <p>{useFlag("meal-planner" as FlagName) ? "planner on" : "planner off"}</p>;
    }
    const On = createTestRoutesStub([{ id: "root", path: "/", loader: () => ({ flags: ["meal-planner"] }), Component: Probe }]);
    const { unmount } = render(<On />);
    expect(await screen.findByText("planner on")).toBeTruthy();
    unmount();

    const Off = createTestRoutesStub([{ id: "root", path: "/", loader: () => ({}), Component: Probe }]);
    render(<Off />);
    expect(await screen.findByText("planner off")).toBeTruthy();
  });
});
