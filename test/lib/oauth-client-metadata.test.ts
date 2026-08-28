import { describe, expect, it } from "vitest";

import {
  MAX_OAUTH_CLIENT_NAME_CODE_POINTS,
  hasProhibitedOAuthClientNameCharacters,
  safeOAuthClientDisplayName,
} from "~/lib/oauth-client-metadata";

describe("OAuth client metadata", () => {
  it("detects control and bidirectional formatting characters", () => {
    for (const character of [
      "\u0000",
      "\u001f",
      "\u007f",
      "\u061c",
      "\u200e",
      "\u200f",
      "\u202a",
      "\u202e",
      "\u2066",
      "\u2069",
    ]) {
      expect(hasProhibitedOAuthClientNameCharacters(`safe${character}name`)).toBe(true);
    }
  });

  it("allows ordinary Unicode and zero-width joiners", () => {
    expect(hasProhibitedOAuthClientNameCharacters("Cookbook 👩‍🍳")).toBe(false);
  });

  it("sanitizes legacy display names without splitting Unicode code points", () => {
    const longName = `${"🍲".repeat(MAX_OAUTH_CLIENT_NAME_CODE_POINTS + 1)}\u202e`;

    expect(Array.from(safeOAuthClientDisplayName(longName))).toHaveLength(
      MAX_OAUTH_CLIENT_NAME_CODE_POINTS,
    );
    expect(safeOAuthClientDisplayName("Example\u0000\u061c\u200e\u202a\u2066 App")).toBe(
      "Example App",
    );
  });

  it("uses a neutral fallback for absent or empty legacy names", () => {
    expect(safeOAuthClientDisplayName(undefined)).toBe("This app");
    expect(safeOAuthClientDisplayName(null)).toBe("This app");
    expect(safeOAuthClientDisplayName(" \u0000\u202e ")).toBe("This app");
  });
});
