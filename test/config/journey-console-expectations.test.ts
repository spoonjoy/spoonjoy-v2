import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const fixtureState = vi.hoisted(() => ({ extension: undefined as unknown }));
vi.mock("@playwright/test", () => ({
  test: { extend: (extension: unknown) => { fixtureState.extension = extension; return {}; } },
  expect: () => undefined,
}));

await import("../../e2e/journeys/support/journey");

const MISSING_URL = "https://qa.example.test/recipes/qa-kitchen-recipe-that-was-never-written";
const NOISE = "Failed to load resource: the server responded with a status of 404 (Not Found)";
const PATTERN = /^Failed to load resource: the server responded with a status of 404(?: \((?:Not Found)?\))?$/;
const URL_PATTERN = /^https:\/\/qa\.example\.test\/recipes\/qa-kitchen-recipe-that-was-never-written$/;
type Options = { url?: RegExp; optional?: boolean };
type Registration = (pattern: RegExp, options?: Options) => void;
type FixtureContext = { consoleExpectations: unknown[] };
const fixtures = fixtureState.extension as {
  expectConsoleError(context: FixtureContext, use: (register: Registration) => Promise<void>): Promise<void>;
  consoleGate: [(context: FixtureContext & { page: EventEmitter }, use: () => Promise<void>) => Promise<void>];
};

async function check(
  issues: Array<{ text: string; url?: string; pageError?: boolean }>,
  options: Options = { url: URL_PATTERN, optional: true },
) {
  const page = new EventEmitter();
  const context = { page, consoleExpectations: [] };
  await fixtures.expectConsoleError(context, async (register) => register(PATTERN, options));
  await fixtures.consoleGate[0](context, async () => {
    for (const issue of issues) {
      if (issue.pageError) page.emit("pageerror", new Error(issue.text));
      else page.emit("console", {
        type: () => "error", text: () => issue.text, location: () => ({ url: issue.url ?? "" }),
      });
    }
  });
  expect(page.listenerCount("console")).toBe(0);
  expect(page.listenerCount("pageerror")).toBe(0);
}

describe("scenario-local optional network diagnostics", () => {
  it("accepts an actual silent 404 when the caller explicitly opts in for that URL", async () => {
    await expect(check([])).resolves.toBeUndefined();
  });

  it("accepts exactly the browser's expected 404 noise for the missing-recipe URL", async () => {
    await expect(check([{ text: NOISE, url: MISSING_URL }])).resolves.toBeUndefined();
  });

  it.each([
    [{ text: "Unexpected app error", url: MISSING_URL }],
    [{ text: NOISE, url: "https://qa.example.test/recipes/unrelated" }],
    [{ text: NOISE }],
    [{ text: NOISE, url: `${MISSING_URL}/other` }],
    [{ text: NOISE, pageError: true }],
    [{ text: `${NOISE} unexpected detail`, url: MISSING_URL }],
    [{ text: NOISE, url: MISSING_URL }, { text: "Unexpected app error", url: MISSING_URL }],
    [{ text: NOISE, url: MISSING_URL }, { text: NOISE, url: MISSING_URL }],
  ].map((issues) => ({ issues })))("still rejects unexpected, unscoped or extra errors: %j", async ({ issues }) => {
    await expect(check(issues)).rejects.toThrow("Console errors during test:");
  });

  it("keeps existing registrations mandatory by default", async () => {
    await expect(check([], { url: URL_PATTERN })).rejects.toThrow("never matched");
    await expect(check([{ text: NOISE, url: MISSING_URL }], { url: URL_PATTERN })).resolves.toBeUndefined();
  });

  it("requires a URL scope for an optional diagnostic", async () => {
    await expect(check([], { optional: true })).rejects.toThrow("Optional console diagnostics require a URL scope");
  });
});
