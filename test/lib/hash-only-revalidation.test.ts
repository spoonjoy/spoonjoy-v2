import { describe, it, expect } from "vitest";
import type { ShouldRevalidateFunctionArgs } from "react-router";
import { revalidateUnlessHashOnly } from "~/lib/hash-only-revalidation";
import { shouldRevalidate as rootShouldRevalidate } from "~/root";
import { shouldRevalidate as recipeShouldRevalidate } from "~/routes/recipes.$id";

function args(current: string, next: string, overrides: Partial<ShouldRevalidateFunctionArgs> = {}): ShouldRevalidateFunctionArgs {
  return {
    currentUrl: new URL(current, "https://spoonjoy.test"),
    currentParams: {},
    nextUrl: new URL(next, "https://spoonjoy.test"),
    nextParams: {},
    defaultShouldRevalidate: true,
    ...overrides,
  } as ShouldRevalidateFunctionArgs;
}

describe("revalidateUnlessHashOnly", () => {
  it("skips revalidation when only the hash changes (entering or leaving cook mode)", () => {
    expect(revalidateUnlessHashOnly(args("/recipes/r1", "/recipes/r1#cook"))).toBe(false);
    expect(revalidateUnlessHashOnly(args("/recipes/r1?from=home#cook", "/recipes/r1?from=home"))).toBe(false);
  });

  it("keeps the default for an explicit revalidation, which keeps the same hash", () => {
    expect(revalidateUnlessHashOnly(args("/recipes/r1#cook", "/recipes/r1#cook"))).toBe(true);
    expect(revalidateUnlessHashOnly(args("/recipes/r1", "/recipes/r1", { defaultShouldRevalidate: false }))).toBe(false);
  });

  it("keeps the default when the path or query changes", () => {
    expect(revalidateUnlessHashOnly(args("/recipes/r1#cook", "/recipes/r2"))).toBe(true);
    expect(revalidateUnlessHashOnly(args("/recipes/r1#cook", "/recipes/r1?x=1"))).toBe(true);
  });

  it("keeps the default after a form submission, even to the same page with another hash", () => {
    expect(revalidateUnlessHashOnly(args("/recipes/r1#cook", "/recipes/r1", { formMethod: "POST" }))).toBe(true);
  });

  it("is what the root and recipe routes use", () => {
    expect(rootShouldRevalidate(args("/recipes/r1#cook", "/recipes/r1"))).toBe(false);
    expect(recipeShouldRevalidate(args("/recipes/r1#cook", "/recipes/r1"))).toBe(false);
    expect(rootShouldRevalidate(args("/", "/recipes"))).toBe(true);
    expect(recipeShouldRevalidate(args("/recipes/r1", "/recipes/r1"))).toBe(true);
  });
});
