import { describe, expect, it } from "vitest";
import {
  extractOpenAIErrorFields,
  openAIErrorCode,
  openAIErrorStatus,
  openAIErrorType,
} from "~/lib/openai-error.server";

describe("openAIErrorCode", () => {
  it("reads a top-level string code", () => {
    expect(openAIErrorCode({ code: "insufficient_quota" })).toBe("insufficient_quota");
  });

  it("reads a nested error.code when no top-level code is present", () => {
    expect(openAIErrorCode({ error: { code: "model_not_found" } })).toBe("model_not_found");
  });

  it("prefers the top-level code over the nested one", () => {
    expect(
      openAIErrorCode({ code: "rate_limit_exceeded", error: { code: "ignored" } }),
    ).toBe("rate_limit_exceeded");
  });

  it("returns null for an empty-string code", () => {
    expect(openAIErrorCode({ code: "" })).toBeNull();
  });

  it("returns null when code is non-string", () => {
    expect(openAIErrorCode({ code: 429 })).toBeNull();
  });

  it("returns null when nested error is not an object", () => {
    expect(openAIErrorCode({ error: "boom" })).toBeNull();
  });

  it("returns null for non-object errors", () => {
    expect(openAIErrorCode("nope")).toBeNull();
    expect(openAIErrorCode(null)).toBeNull();
  });
});

describe("openAIErrorType", () => {
  it("reads a top-level string type", () => {
    expect(openAIErrorType({ type: "insufficient_quota" })).toBe("insufficient_quota");
  });

  it("reads a nested error.type when no top-level type is present", () => {
    expect(openAIErrorType({ error: { type: "invalid_request_error" } })).toBe(
      "invalid_request_error",
    );
  });

  it("returns null when neither is present", () => {
    expect(openAIErrorType({ code: "x" })).toBeNull();
  });

  it("returns null for non-object errors", () => {
    expect(openAIErrorType(42)).toBeNull();
  });
});

describe("openAIErrorStatus", () => {
  it("reads a numeric status", () => {
    expect(openAIErrorStatus({ status: 429 })).toBe(429);
  });

  it("returns null when status is non-numeric", () => {
    expect(openAIErrorStatus({ status: "429" })).toBeNull();
  });

  it("returns null for non-object errors", () => {
    expect(openAIErrorStatus(undefined)).toBeNull();
  });
});

describe("extractOpenAIErrorFields", () => {
  it("collects code, type, and status from a flat SDK error", () => {
    const err = Object.assign(new Error("quota"), {
      code: "insufficient_quota",
      type: "insufficient_quota",
      status: 429,
    });
    expect(extractOpenAIErrorFields(err)).toEqual({
      code: "insufficient_quota",
      type: "insufficient_quota",
      status: 429,
    });
  });

  it("collects fields from a nested error body", () => {
    expect(
      extractOpenAIErrorFields({ status: 404, error: { code: "model_not_found", type: "invalid_request_error" } }),
    ).toEqual({
      code: "model_not_found",
      type: "invalid_request_error",
      status: 404,
    });
  });

  it("returns all-null for an unstructured error", () => {
    expect(extractOpenAIErrorFields("plain string")).toEqual({
      code: null,
      type: null,
      status: null,
    });
  });
});
