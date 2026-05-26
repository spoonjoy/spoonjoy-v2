import { describe, expect, it } from "vitest";
import {
  REQUIRED_RUNTIME_SECRETS,
  OPTIONAL_FEATURE_SECRET_GROUPS,
  INTENTIONALLY_DISABLED_FEATURE_GROUPS,
  evaluateSecretReadiness,
  hasUserPhotoUrlColumn,
  validatePwaAssetSet,
  validateCutoverRunbook,
} from "../../scripts/production-readiness";

describe("production readiness helpers", () => {
  it("passes required runtime secrets and reports missing optional feature groups", () => {
    const result = evaluateSecretReadiness([
      ...REQUIRED_RUNTIME_SECRETS,
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
    ]);

    expect(result.requiredMissing).toEqual([]);
    expect(result.configuredFeatureGroups).toEqual(["Google OAuth", "GitHub OAuth"]);
    expect(result.missingFeatureGroups).toEqual(["Apple OAuth", "OpenAI AI features"]);
    expect(result.intentionallyDisabledFeatureGroups).toEqual([]);
  });

  it("passes intentionally disabled optional feature groups", () => {
    const result = evaluateSecretReadiness([
      ...REQUIRED_RUNTIME_SECRETS,
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "APPLE_CLIENT_ID",
      "APPLE_TEAM_ID",
      "APPLE_KEY_ID",
      "APPLE_PRIVATE_KEY",
      "OPENAI_API_KEY",
    ]);

    expect(result.requiredMissing).toEqual([]);
    expect(result.configuredFeatureGroups).toEqual([
      "GitHub OAuth",
      "Apple OAuth",
      "OpenAI AI features",
    ]);
    expect(result.missingFeatureGroups).toEqual([]);
    expect(result.intentionallyDisabledFeatureGroups).toEqual(["Google OAuth"]);
  });

  it("reports missing required runtime secrets", () => {
    const result = evaluateSecretReadiness(["SESSION_SECRET"]);

    expect(result.requiredMissing).toEqual([
      "VAPID_PUBLIC_KEY",
      "VAPID_PRIVATE_KEY",
      "VAPID_SUBJECT",
    ]);
  });

  it("keeps optional feature group definitions complete", () => {
    expect(OPTIONAL_FEATURE_SECRET_GROUPS).toEqual([
      {
        name: "Google OAuth",
        secrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
      },
      {
        name: "GitHub OAuth",
        secrets: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
      },
      {
        name: "Apple OAuth",
        secrets: ["APPLE_CLIENT_ID", "APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY"],
      },
      {
        name: "OpenAI AI features",
        secrets: ["OPENAI_API_KEY"],
      },
    ]);
    expect(INTENTIONALLY_DISABLED_FEATURE_GROUPS).toEqual(["Google OAuth"]);
  });

  it("detects the remote User.photoUrl column from pragma rows", () => {
    expect(hasUserPhotoUrlColumn([{ name: "id" }, { name: "photoUrl" }])).toBe(true);
    expect(hasUserPhotoUrlColumn([{ name: "id" }, { name: "email" }])).toBe(false);
  });

  it("validates the required PWA asset set", () => {
    expect(validatePwaAssetSet(["public/manifest.webmanifest", "public/sw.js", "public/icons/sj-192.png", "public/icons/sj-512.png"])).toEqual([]);
    expect(validatePwaAssetSet(["public/manifest.webmanifest"])).toEqual([
      "public/sw.js",
      "public/icons/sj-192.png",
      "public/icons/sj-512.png",
    ]);
  });

  it("validates production cutover runbook coverage", () => {
    const validRunbook = [
      "spoonjoy.app",
      "data migration",
      "DNS",
      "OAuth",
      "smoke test",
      "rollback",
    ].join("\n");

    expect(validateCutoverRunbook(validRunbook)).toEqual([]);
    expect(validateCutoverRunbook("spoonjoy.app")).toEqual([
      "data migration",
      "DNS",
      "OAuth",
      "smoke test",
      "rollback",
    ]);
  });
});
