import { describe, expect, it } from "vitest";
import {
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  isReservedUsername,
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

  it("reads a string and treats anything else (a file entry, a JSON number) as empty", () => {
    expect(normalizeUsername(" chef ")).toBe("chef");
    expect(normalizeUsername(new File(["x"], "x.txt"))).toBe("");
    expect(normalizeUsername(456)).toBe("");
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

  it("requires at least one letter or digit", () => {
    const message = "Username must include a letter or a number";
    expect(usernameFormatError("...")).toBe(message);
    expect(usernameFormatError("-_-")).toBe(message);
    expect(usernameFormatError("_a_")).toBeNull();
  });

  it("reserves the deleted-chef username in any letter case", () => {
    expect(isReservedUsername("deleted-chef")).toBe(true);
    expect(isReservedUsername("DELETED-CHEF")).toBe(true);
    expect(isReservedUsername("deleted-chef-1")).toBe(false);
  });

  it("rejects a username shaped like an account ID, whatever its case", () => {
    const message = "Username can't look like an account ID";
    expect(usernameFormatError("cmg1a2b3c0000d4e5f6g7h8i9")).toBe(message);
    expect(usernameFormatError("CMG1A2B3C0000D4E5F6G7H8I9")).toBe(message);
    // One character shorter or longer, or not starting with c, is not an ID.
    expect(usernameFormatError("cmg1a2b3c0000d4e5f6g7h8i")).toBeNull();
    expect(usernameFormatError("cmg1a2b3c0000d4e5f6g7h8i9j")).toBeNull();
    expect(usernameFormatError("amg1a2b3c0000d4e5f6g7h8i9")).toBeNull();
  });
});
