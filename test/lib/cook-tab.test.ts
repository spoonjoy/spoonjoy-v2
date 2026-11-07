import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COOK_TAB_STORAGE_KEY,
  cookTabStepIndex,
  parseCookTabState,
  readCookTab,
  writeCookTab,
  type CookTabState,
} from "~/lib/cook-tab";

const state: CookTabState = { recipeId: "r1", mode: "cook", activeStepIndex: 2, activeStepId: "s3" };

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("this tab's cooking state", () => {
  it("round-trips through sessionStorage for its own recipe only", () => {
    writeCookTab(state);
    expect(JSON.parse(window.sessionStorage.getItem(COOK_TAB_STORAGE_KEY)!)).toEqual(state);
    expect(readCookTab("r1")).toEqual(state);
    expect(readCookTab("r2")).toBeNull();
  });

  it("drops anything malformed", () => {
    expect(parseCookTabState(null)).toBeNull();
    expect(parseCookTabState("nope")).toBeNull();
    expect(parseCookTabState("null")).toBeNull();
    expect(parseCookTabState(JSON.stringify({ ...state, recipeId: 1 }))).toBeNull();
    expect(parseCookTabState(JSON.stringify({ ...state, mode: "edit" }))).toBeNull();
    expect(parseCookTabState(JSON.stringify({ ...state, activeStepIndex: "2" }))).toBeNull();
    expect(parseCookTabState(JSON.stringify({ ...state, activeStepIndex: 1.5 }))).toBeNull();
    expect(parseCookTabState(JSON.stringify({ ...state, activeStepIndex: -1 }))).toBeNull();
    expect(parseCookTabState(JSON.stringify({ ...state, mode: "read", activeStepId: 3 }))).toEqual({ ...state, mode: "read", activeStepId: null });
  });

  it("carries on when storage is unavailable", () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readCookTab("r1")).toBeNull();
    expect(() => writeCookTab(state)).not.toThrow();
  });

  it("finds the step by id, falling back to the index within the recipe", () => {
    expect(cookTabStepIndex(state, ["s1", "s3"])).toBe(1);
    expect(cookTabStepIndex(state, ["s1", "s2", "s4", "s5"])).toBe(2);
    expect(cookTabStepIndex({ ...state, activeStepId: null }, ["s1"])).toBe(0);
    expect(cookTabStepIndex(state, [])).toBeNull();
  });
});
