import { describe, expect, it } from "vitest";
import {
  OBJECTIONABLE_CONTENT_MESSAGE,
  ObjectionableContentError,
  assertAcceptableText,
  containsObjectionableContent,
} from "~/lib/objectionable-terms";

describe("objectionable terms", () => {
  it("finds a listed term as a whole word, in any case, plural or with digit swaps", () => {
    expect(containsObjectionableContent("Free PORN here")).toBe(true);
    expect(containsObjectionableContent("dildos")).toBe(true);
    expect(containsObjectionableContent("p0rn")).toBe(true);
    expect(containsObjectionableContent("best-hentai!")).toBe(true);
  });

  it("leaves ordinary cooking words alone", () => {
    expect(containsObjectionableContent("Warm spices and spiced rice")).toBe(false);
    expect(containsObjectionableContent("Pornstar martini? No: popcorn")).toBe(false);
    expect(containsObjectionableContent("Cost: $5 for 1 lemon")).toBe(false);
    expect(containsObjectionableContent("")).toBe(false);
    expect(containsObjectionableContent(null)).toBe(false);
    expect(containsObjectionableContent(undefined)).toBe(false);
  });

  it("throws for any objectionable text and passes clean or missing text", () => {
    expect(() => assertAcceptableText("Soup", null, undefined, "Bread")).not.toThrow();
    expect(() => assertAcceptableText("Soup", "gangbang")).toThrow(ObjectionableContentError);
    try {
      assertAcceptableText("porn");
    } catch (error) {
      expect((error as Error).message).toBe(OBJECTIONABLE_CONTENT_MESSAGE);
      expect((error as Error).name).toBe("ObjectionableContentError");
    }
  });
});
