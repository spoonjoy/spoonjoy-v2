import { describe, expect, it } from "vitest";
import {
  UNKNOWN_SOURCE_SHA,
  buildSourceSha,
  deploymentMetadataFromEnv,
  normalizeSourceSha,
} from "~/lib/build-info.server";

const VALID_SHA = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d";

describe("normalizeSourceSha", () => {
  it("returns a well-formed 40-char lowercase-hex SHA unchanged", () => {
    expect(normalizeSourceSha(VALID_SHA)).toBe(VALID_SHA);
  });

  it("rejects a SHA of the wrong length or with non-hex characters", () => {
    expect(normalizeSourceSha("abc123")).toBe(UNKNOWN_SOURCE_SHA);
    expect(normalizeSourceSha(`${VALID_SHA}00`)).toBe(UNKNOWN_SOURCE_SHA);
    expect(normalizeSourceSha("ZZ2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d")).toBe(UNKNOWN_SOURCE_SHA);
  });

  it("treats an uppercase SHA as invalid (Cloudflare/git emit lowercase)", () => {
    expect(normalizeSourceSha(VALID_SHA.toUpperCase())).toBe(UNKNOWN_SOURCE_SHA);
  });

  it("falls back to the sentinel for null or undefined", () => {
    expect(normalizeSourceSha(null)).toBe(UNKNOWN_SOURCE_SHA);
    expect(normalizeSourceSha(undefined)).toBe(UNKNOWN_SOURCE_SHA);
  });
});

describe("buildSourceSha", () => {
  it("returns the sentinel when the build-time define is absent (unit-test context)", () => {
    // The `__SPOONJOY_SOURCE_SHA__` define is injected only by the Vite build,
    // never under vitest, so the sentinel is the deterministic value here.
    expect(buildSourceSha()).toBe(UNKNOWN_SOURCE_SHA);
  });
});

describe("deploymentMetadataFromEnv", () => {
  it("returns null when the env is missing", () => {
    expect(deploymentMetadataFromEnv(null)).toBeNull();
    expect(deploymentMetadataFromEnv(undefined)).toBeNull();
  });

  it("returns null when the CF_VERSION_METADATA binding is absent", () => {
    expect(deploymentMetadataFromEnv({})).toBeNull();
  });

  it("returns null when the version id is empty or not a string", () => {
    expect(deploymentMetadataFromEnv({ CF_VERSION_METADATA: { id: "" } })).toBeNull();
    expect(
      deploymentMetadataFromEnv({ CF_VERSION_METADATA: { id: 123 as unknown as string } }),
    ).toBeNull();
  });

  it("maps a fully-populated binding to id/tag/timestamp", () => {
    expect(
      deploymentMetadataFromEnv({
        CF_VERSION_METADATA: { id: "cf-version-123", tag: "prod", timestamp: "2026-07-24T00:00:00.000Z" },
      }),
    ).toEqual({ id: "cf-version-123", tag: "prod", timestamp: "2026-07-24T00:00:00.000Z" });
  });

  it("defaults a missing tag and timestamp to empty strings", () => {
    expect(deploymentMetadataFromEnv({ CF_VERSION_METADATA: { id: "cf-version-123" } })).toEqual({
      id: "cf-version-123",
      tag: "",
      timestamp: "",
    });
  });
});
