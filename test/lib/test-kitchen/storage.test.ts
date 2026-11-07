import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TEST_KITCHEN_STORAGE_KEY,
  readTestKitchen,
  resetTestKitchen,
  testKitchenProgressStorage,
  writeTestKitchen,
} from "~/lib/test-kitchen/storage";

const progress = { checkedIngredientIds: ["a"], checkedStepOutputIds: ["b"], activeStepIndex: 1, scaleFactor: 1.5 };
const fresh = { version: 1, recipes: {} };
const save = (value: unknown) => window.localStorage.setItem(TEST_KITCHEN_STORAGE_KEY, JSON.stringify(value));

describe("Test Kitchen storage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("reads a fresh kitchen when nothing is saved", () => {
    expect(readTestKitchen()).toEqual(fresh);
  });

  it("reads back what it wrote", () => {
    writeTestKitchen({ version: 1, recipes: { chickpeas: progress } });
    expect(readTestKitchen()).toEqual({ version: 1, recipes: { chickpeas: progress } });
  });

  it("reads a fresh kitchen when storage is unavailable", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    expect(readTestKitchen()).toEqual(fresh);
  });

  it("reads a fresh kitchen when getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage is disabled");
    });
    expect(readTestKitchen()).toEqual(fresh);
  });

  it.each([
    ["garbage JSON", "{not json"],
    ["JSON that is not an object", "42"],
    ["null", "null"],
    ["another version", JSON.stringify({ version: 0, recipes: { chickpeas: progress } })],
    ["recipes that are not an object", JSON.stringify({ version: 1, recipes: "chickpeas" })],
    ["recipes as a list", JSON.stringify({ version: 1, recipes: [progress] })],
    ["no recipes", JSON.stringify({ version: 1, recipes: null })],
  ])("reads a fresh kitchen from %s", (_, raw) => {
    window.localStorage.setItem(TEST_KITCHEN_STORAGE_KEY, raw);
    expect(readTestKitchen()).toEqual(fresh);
  });

  it.each([
    ["is not an object", 7],
    ["is null", null],
    ["has ingredient ids that are not strings", { ...progress, checkedIngredientIds: [1] }],
    ["has step outputs that are not a list", { ...progress, checkedStepOutputIds: "b" }],
    ["has a fractional step", { ...progress, activeStepIndex: 1.5 }],
    ["has a negative step", { ...progress, activeStepIndex: -1 }],
    ["has a scale that is not a number", { ...progress, scaleFactor: "2" }],
    ["has an infinite scale", { ...progress, scaleFactor: Number.POSITIVE_INFINITY }],
    ["has a scale of zero", { ...progress, scaleFactor: 0 }],
  ])("drops a recipe whose progress %s and keeps the others", (_, bad) => {
    save({ version: 1, recipes: { chickpeas: progress, broken: bad } });
    expect(readTestKitchen()).toEqual({ version: 1, recipes: { chickpeas: progress } });
  });

  it("keeps working in memory when storage is full", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    expect(() => writeTestKitchen({ version: 1, recipes: { chickpeas: progress } })).not.toThrow();
    expect(() => testKitchenProgressStorage.write("chickpeas", progress)).not.toThrow();
  });

  it("forgets everything on reset", () => {
    writeTestKitchen({ version: 1, recipes: { chickpeas: progress } });
    resetTestKitchen();
    expect(window.localStorage.getItem(TEST_KITCHEN_STORAGE_KEY)).toBeNull();
    expect(readTestKitchen()).toEqual(fresh);
  });

  it("resets without throwing when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage is disabled");
    });
    expect(() => resetTestKitchen()).not.toThrow();
  });

  it("reads and writes one recipe's progress, leaving the others alone", () => {
    writeTestKitchen({ version: 1, recipes: { other: progress } });
    expect(testKitchenProgressStorage.read("chickpeas")).toBeNull();

    const next = { ...progress, activeStepIndex: 2 };
    testKitchenProgressStorage.write("chickpeas", next);
    expect(testKitchenProgressStorage.read("chickpeas")).toEqual(next);
    expect(readTestKitchen()).toEqual({ version: 1, recipes: { other: progress, chickpeas: next } });
  });
});
