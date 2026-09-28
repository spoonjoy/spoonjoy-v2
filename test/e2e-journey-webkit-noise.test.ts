// The journeys' console gate ignores WebKit's log for a same-origin fetch cut off by navigation
// (e2e/journeys/support/webkit-noise.ts), and nothing else.
import { describe, expect, it } from "vitest";
import { isWebKitCancelledSameOriginFetch } from "../e2e/journeys/support/webkit-noise";

const BASE = "https://spoonjoy-v2-qa.mendelow-studio.workers.dev";
const SAME = `${BASE}/api/cook-sessions/3af885f3-5bb3-4c8e-8ac6-08c041224cc6`;

// The shape Playwright reported on iPhone WebKit (run 36357330169): the message lost its prefix
// at the scheme's colon, and the stack kept the whole line.
function webKitError(url: string) {
  return {
    message: `${url.replace(/^https:\/?/, "")} due to access control checks.`,
    stack: `Fetch API cannot load ${url} due to access control checks.\n    at c (${BASE}/assets/bookmark.js:1:4331)\n    at reconcile (${BASE}/assets/bookmark.js:1:9000)`,
  };
}

describe("isWebKitCancelledSameOriginFetch", () => {
  it("ignores a same-origin fetch that WebKit cut off, read from the stack", () => {
    expect(isWebKitCancelledSameOriginFetch(webKitError(SAME), BASE)).toBe(true);
  });

  it("reads the whole line from the message when there is no stack", () => {
    expect(isWebKitCancelledSameOriginFetch(
      { message: `Fetch API cannot load ${SAME} due to access control checks.` },
      `${BASE}/`,
    )).toBe(true);
  });

  it("still fails a cross-origin fetch, which is a real CORS failure", () => {
    expect(isWebKitCancelledSameOriginFetch(webKitError("https://api.example.com/v1/things"), BASE)).toBe(false);
  });

  it("still fails any other error", () => {
    expect(isWebKitCancelledSameOriginFetch({ message: "TypeError: x is undefined", stack: "at y" }, BASE)).toBe(false);
    expect(isWebKitCancelledSameOriginFetch({ message: "Load failed" }, BASE)).toBe(false);
  });

  it("fails closed without a base URL or with an unparseable URL", () => {
    expect(isWebKitCancelledSameOriginFetch(webKitError(SAME), undefined)).toBe(false);
    expect(isWebKitCancelledSameOriginFetch(
      { message: "Fetch API cannot load not-a-url due to access control checks." },
      BASE,
    )).toBe(false);
  });
});
