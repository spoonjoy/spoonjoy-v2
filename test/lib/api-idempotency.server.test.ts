import { describe, expect, it } from "vitest";

describe("API idempotency helpers", () => {
  it("exports helpers for hashing, reserving, completing, and replaying idempotent mutations", async () => {
    const mod = await import("~/lib/api-idempotency.server");

    expect(mod).toMatchObject({
      hashIdempotencyRequest: expect.any(Function),
      idempotencyClientKey: expect.any(Function),
      reserveIdempotencyKey: expect.any(Function),
      completeIdempotencyKey: expect.any(Function),
      replayIdempotencyResponse: expect.any(Function),
      IdempotencyConflictError: expect.any(Function),
    });
  });
});
