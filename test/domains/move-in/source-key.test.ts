import { describe, expect, it } from "vitest";
import { joinKey, normalizeGuid, tableRowKey } from "~/domains/move-in/model/source-key";

describe("normalizeGuid", () => {
  it("writes SQLite's undashed hex and Postgres's dashed form the same way", () => {
    expect(normalizeGuid("0D9A1C2E4B5F47A1B2C3D4E5F6A7B8C9")).toBe("0d9a1c2e-4b5f-47a1-b2c3-d4e5f6a7b8c9");
    expect(normalizeGuid("0d9a1c2e-4b5f-47a1-b2c3-d4e5f6a7b8c9")).toBe("0d9a1c2e-4b5f-47a1-b2c3-d4e5f6a7b8c9");
    expect(normalizeGuid(" {0d9a1c2e-4b5f-47a1-b2c3-d4e5f6a7b8c9} ")).toBe("0d9a1c2e-4b5f-47a1-b2c3-d4e5f6a7b8c9");
  });

  it("returns null for anything that is not a GUID", () => {
    expect(normalizeGuid(null)).toBeNull();
    expect(normalizeGuid(undefined)).toBeNull();
    expect(normalizeGuid(42)).toBeNull();
    expect(normalizeGuid("pad-thai")).toBeNull();
    expect(normalizeGuid("0d9a1c2e4b5f47a1b2c3d4e5f6a7b8c")).toBeNull();
  });
});

describe("tableRowKey", () => {
  it("keys GUID rows by the GUID and integer rows by table and id", () => {
    expect(tableRowKey("recipes", "0D9A1C2E4B5F47A1B2C3D4E5F6A7B8C9")).toBe("0d9a1c2e-4b5f-47a1-b2c3-d4e5f6a7b8c9");
    expect(tableRowKey("notes", 7)).toBe("notes:7");
    expect(tableRowKey("notes", "7")).toBe("notes:7");
    expect(tableRowKey("notes", null)).toBeNull();
    expect(tableRowKey("notes", "")).toBeNull();
  });
});

describe("joinKey", () => {
  it("keys a join row by its pair of keys", () => {
    expect(joinKey("0D9A1C2E4B5F47A1B2C3D4E5F6A7B8C9", "11111111-1111-1111-1111-111111111111")).toBe(
      "0d9a1c2e-4b5f-47a1-b2c3-d4e5f6a7b8c9|11111111-1111-1111-1111-111111111111",
    );
    expect(joinKey("x", "11111111-1111-1111-1111-111111111111")).toBeNull();
    expect(joinKey("11111111-1111-1111-1111-111111111111", "y")).toBeNull();
  });
});
