import { describe, expect, it } from "vitest";
import { LIKE_CONTAINS_MAX_BYTES, likeContains, likeContainsPrefix, likeContainsSearch } from "~/domains/platform";

const bytes = (text: string) => new TextEncoder().encode(text).length;

describe("searching within D1's LIKE limit", () => {
  it("keeps text that fits whole, and cuts longer text to 48 bytes", () => {
    expect(likeContainsPrefix("")).toBe("");
    expect(likeContainsPrefix("a".repeat(48))).toBe("a".repeat(48));
    expect(likeContainsPrefix("a".repeat(60))).toBe("a".repeat(48));
    expect(bytes(likeContainsPrefix("a".repeat(60)))).toBe(LIKE_CONTAINS_MAX_BYTES);
  });

  it("never splits a character, so the prefix stays valid UTF-8", () => {
    // é is 2 bytes and 🍋 is 4 (a surrogate pair in JavaScript): 47 + 2 would be 49.
    expect(likeContainsPrefix(`${"a".repeat(47)}é and more`)).toBe("a".repeat(47));
    expect(likeContainsPrefix(`${"a".repeat(45)}🍋 and more`)).toBe("a".repeat(45));
    expect(likeContainsPrefix(`${"a".repeat(44)}🍋 and more`)).toBe(`${"a".repeat(44)}🍋`);
    expect(likeContainsPrefix("é".repeat(30))).toBe("é".repeat(24));
  });

  it("matches as LIKE does: ASCII letters in either case, other characters exactly, and nothing in no text", () => {
    expect(likeContains("Lemon Herb Rice", "herb RICE")).toBe(true);
    expect(likeContains("Lemon Herb Rice", "herbs")).toBe(false);
    expect(likeContains("ÉCLAIR", "éclair")).toBe(false);
    expect(likeContains("éclair", "éclair")).toBe(true);
    expect(likeContains(null, "x")).toBe(false);
    expect(likeContains(undefined, "x")).toBe(false);
  });

  it("narrows only a query too long for one pattern, and then checks every text for the whole query", () => {
    expect(likeContainsSearch("soup")).toMatchObject({ pattern: "soup", narrowed: false });
    const query = `${"Slow Roasted ".repeat(4)}Tomato Soup`;
    const search = likeContainsSearch(query);
    expect(search).toMatchObject({ pattern: query.slice(0, 48), narrowed: true });
    expect(search.matches(null, `My ${query.toLowerCase()} for winter`)).toBe(true);
    expect(search.matches(`${"Slow Roasted ".repeat(4)}Tomato Stew`, undefined)).toBe(false);
  });
});
