// The journeys' expectNoHydrationErrors (e2e/journeys/support/hydration.ts) fails on React's
// hydration and recoverable-error reports, in development and production wording, and nothing else.
import { describe, expect, it } from "vitest";
import { hydrationErrorMessages } from "../e2e/journeys/support/hydration-errors";

describe("hydrationErrorMessages", () => {
  it("finds React's development hydration reports", () => {
    const messages = [
      "Hydration failed because the server rendered HTML didn't match the client.",
      "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties.",
      "There was an error while hydrating but React was able to recover by instead client rendering the entire root.",
      "Uncaught Error: a recoverable error",
    ];
    expect(hydrationErrorMessages(messages)).toEqual(messages);
  });

  it("finds React's minified production hydration errors, by code or by link", () => {
    const messages = [
      "Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message",
      "Uncaught Error: Minified React error #423",
      "Error: see https://react.dev/errors/425",
      "Minified React error #419",
      "Minified React error #421",
      "Minified React error #422",
    ];
    expect(hydrationErrorMessages(messages)).toEqual(messages);
  });

  it("ignores every other message", () => {
    expect(hydrationErrorMessages([
      "Failed to load resource: the server responded with a status of 404 ()",
      "Minified React error #31; visit https://react.dev/errors/31",
      "Minified React error #4180",
      "Cook progress could not sync",
    ])).toEqual([]);
  });
});
