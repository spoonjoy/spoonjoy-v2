import { describe, expect, it, vi } from "vitest";
import {
  PRODUCT_ACTIVATION_PENDING_CODE,
  PRODUCT_ACTIVATION_PENDING_MESSAGE,
  isSavedRecipeCutoverPendingError,
  productActivationPendingWebResponse,
} from "~/lib/saved-recipe-cutover.server";

const TOKEN = "saved_recipe_cutover_pending";
const WRAPPER_FIELDS = ["message", "cause", "error", "meta", "driverAdapterError"] as const;

function nestedWrapper(field: (typeof WRAPPER_FIELDS)[number], depth: number, value: unknown): unknown {
  let current = value;
  for (let index = 0; index < depth; index += 1) {
    current = { [field]: current };
  }
  return current;
}

describe("saved recipe cutover recognition", () => {
  it("exports the exact temporary activation contract", () => {
    expect(PRODUCT_ACTIVATION_PENDING_CODE).toBe("product_activation_pending");
    expect(PRODUCT_ACTIVATION_PENDING_MESSAGE).toBe(
      "Spoonjoy product activation is still completing. Retry shortly."
    );
  });

  it("builds the retryable web response only for the exact cutover token", () => {
    expect(productActivationPendingWebResponse(new Error("ordinary failure"))).toBeNull();
    expect(productActivationPendingWebResponse(new Error(TOKEN))).toEqual({
      data: {
        error: {
          code: PRODUCT_ACTIVATION_PENDING_CODE,
          message: PRODUCT_ACTIVATION_PENDING_MESSAGE,
          retryable: true,
        },
      },
      init: {
        status: 503,
        headers: {
          "Retry-After": "1",
          "Cache-Control": "private, no-store",
        },
      },
      type: "DataWithResponseInit",
    });
  });

  it.each([
    TOKEN,
    `constraint failed: ${TOKEN}`,
    `(${TOKEN})`,
    `D1_ERROR: ${TOKEN}: SQLITE_CONSTRAINT`,
    `\n${TOKEN}\t`,
    `.${TOKEN}-`,
    `\u00e9${TOKEN}\u754c`,
  ])("recognizes the identifier-bounded token in %j", (value) => {
    expect(isSavedRecipeCutoverPendingError(value)).toBe(true);
  });

  it.each([
    `x${TOKEN}`,
    `${TOKEN}x`,
    `0${TOKEN}`,
    `${TOKEN}9`,
    `_${TOKEN}`,
    `${TOKEN}_suffix`,
    "saved-recipe-cutover-pending",
    "saved_recipe_cutover",
    "SAVED_RECIPE_CUTOVER_PENDING",
    "UNIQUE constraint failed: RecipeInCookbook.cookbookId",
    "product_activation_pending",
  ])("rejects identifier near-misses and unrelated failures in %j", (value) => {
    expect(isSavedRecipeCutoverPendingError(value)).toBe(false);
  });

  it.each(WRAPPER_FIELDS)("follows only the known %s wrapper field", (field) => {
    expect(isSavedRecipeCutoverPendingError({ [field]: TOKEN })).toBe(true);
    expect(isSavedRecipeCutoverPendingError({ [field]: { message: TOKEN } })).toBe(true);
  });

  it("does not inspect arbitrary fields, arrays, symbols, or object stringification", () => {
    const symbol = Symbol("cutover");
    const value = {
      detail: TOKEN,
      response: { message: TOKEN },
      values: [{ message: TOKEN }],
      [symbol]: TOKEN,
      toString: () => TOKEN,
      toJSON: () => ({ message: TOKEN }),
    };

    expect(isSavedRecipeCutoverPendingError(value)).toBe(false);
    expect(isSavedRecipeCutoverPendingError([TOKEN, { message: TOKEN }])).toBe(false);
    expect(isSavedRecipeCutoverPendingError(new Map([["message", TOKEN]]))).toBe(false);
  });

  it.each(WRAPPER_FIELDS)("bounds %s traversal at eight wrapper edges", (field) => {
    expect(isSavedRecipeCutoverPendingError(nestedWrapper(field, 8, TOKEN))).toBe(true);
    expect(isSavedRecipeCutoverPendingError(nestedWrapper(field, 9, TOKEN))).toBe(false);
  });

  it("is cycle-safe while still checking other known branches", () => {
    const first: Record<string, unknown> = {};
    const second: Record<string, unknown> = { cause: first, meta: { error: TOKEN } };
    first.error = second;

    expect(isSavedRecipeCutoverPendingError(first)).toBe(true);

    delete second.meta;
    expect(isSavedRecipeCutoverPendingError(first)).toBe(false);
  });

  it("ignores throwing getters and continues across other known fields", () => {
    const value = Object.defineProperties(
      {},
      {
        cause: {
          enumerable: true,
          get() {
            throw new Error("blocked getter");
          },
        },
        driverAdapterError: {
          enumerable: true,
          value: { message: TOKEN },
        },
      }
    );

    expect(isSavedRecipeCutoverPendingError(value)).toBe(true);
  });

  it("reads a known getter once and treats a lone throwing getter as absent", () => {
    const readableGetter = vi.fn(() => ({ message: TOKEN }));
    const readable = Object.defineProperty({}, "cause", { get: readableGetter });
    const throwing = Object.defineProperty({}, "error", {
      get() {
        throw new Error(TOKEN);
      },
    });

    expect(isSavedRecipeCutoverPendingError(readable)).toBe(true);
    expect(readableGetter).toHaveBeenCalledOnce();
    expect(isSavedRecipeCutoverPendingError(throwing)).toBe(false);
  });

  it("treats a wrapper with a throwing prototype trap as uninspectable", () => {
    const throwingPrototype = new Proxy({}, {
      getPrototypeOf() {
        throw new Error("prototype unavailable");
      },
    });

    expect(isSavedRecipeCutoverPendingError(throwingPrototype)).toBe(false);
  });

  it("handles Error instances and repeated references without widening the field inventory", () => {
    const shared = { message: TOKEN };
    const wrapped = new Error("adapter failed", { cause: shared });
    Object.assign(wrapped, { meta: shared, details: { message: TOKEN } });

    expect(isSavedRecipeCutoverPendingError(wrapped)).toBe(true);
    expect(isSavedRecipeCutoverPendingError({ details: wrapped })).toBe(false);
  });

  it.each([null, undefined, 0, 1, false, true, 1n, Symbol("value"), () => TOKEN])(
    "ignores unsupported primitive or callable value %s",
    (value) => {
      expect(isSavedRecipeCutoverPendingError(value)).toBe(false);
    }
  );
});
