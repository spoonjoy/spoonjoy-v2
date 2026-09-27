import { describe, expect, it } from "vitest";
import { isValidEmail, normalizeEmail } from "~/lib/email";

describe("normalizeEmail", () => {
  it("trims surrounding whitespace and lowercases", () => {
    expect(normalizeEmail("  Chef@Example.COM \n")).toBe("chef@example.com");
  });

  it("treats anything that isn't a string as empty", () => {
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail(undefined)).toBe("");
    expect(normalizeEmail(123)).toBe("");
    expect(normalizeEmail(new File(["x"], "x.txt"))).toBe("");
  });
});

describe("isValidEmail", () => {
  it("accepts an address with a local part, a domain and a dot", () => {
    expect(isValidEmail("chef@example.com")).toBe(true);
  });

  it("rejects missing parts and inner whitespace", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("chef")).toBe(false);
    expect(isValidEmail("chef@example")).toBe(false);
    expect(isValidEmail("che f@example.com")).toBe(false);
  });
});
