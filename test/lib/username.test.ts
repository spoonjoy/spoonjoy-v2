import { describe, expect, it } from "vitest";
import {
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  normalizeUsername,
  usernameFormatError,
} from "~/lib/username";

describe("normalizeUsername", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normalizeUsername("  chef_rj  ")).toBe("chef_rj");
    expect(normalizeUsername("\tchef_rj\n")).toBe("chef_rj");
  });

  it("treats a missing value as empty", () => {
    expect(normalizeUsername(null)).toBe("");
    expect(normalizeUsername(undefined)).toBe("");
  });

  it("reads a FormData string entry and ignores a file entry", () => {
    expect(normalizeUsername(" chef ")).toBe("chef");
    expect(normalizeUsername(new File(["x"], "x.txt"))).toBe("");
  });
});

describe("usernameFormatError", () => {
  it("accepts letters, numbers, periods, underscores and hyphens", () => {
    expect(usernameFormatError("Chef.R-J_42")).toBeNull();
    expect(usernameFormatError("abc")).toBeNull();
    expect(usernameFormatError("a".repeat(USERNAME_MAX_LENGTH))).toBeNull();
  });

  it("rejects usernames shorter than the minimum", () => {
    expect(USERNAME_MIN_LENGTH).toBe(3);
    expect(usernameFormatError("")).toBe("Username must be at least 3 characters");
    expect(usernameFormatError("ab")).toBe("Username must be at least 3 characters");
  });

  it("rejects usernames longer than the maximum", () => {
    expect(USERNAME_MAX_LENGTH).toBe(50);
    expect(usernameFormatError("a".repeat(USERNAME_MAX_LENGTH + 1))).toBe("Username must be at most 50 characters");
  });

  it("rejects spaces, slashes and other characters that don't belong in a profile URL", () => {
    const message = "Username can only use letters, numbers, periods, underscores and hyphens";
    expect(usernameFormatError("chef rj")).toBe(message);
    expect(usernameFormatError(" chef")).toBe(message);
    expect(usernameFormatError("chef/rj")).toBe(message);
    expect(usernameFormatError("chef?rj")).toBe(message);
    expect(usernameFormatError("chéf_rj")).toBe(message);
  });
});
