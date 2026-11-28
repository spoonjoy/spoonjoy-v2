import { beforeAll, describe, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";

// The two tests run in order: the first leaves the page's clock fake, as a test that times out
// while it holds the clock does, and the setup file's afterEach gives the second the real one.
it("setup: a test may end with the page's clock still fake", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  expect(vi.isFakeTimers()).toBe(true);
});

it("setup: the next test starts on the real clock", async () => {
  expect(vi.isFakeTimers()).toBe(false);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
});

// The same order again, for media: the first test leaves reduced motion and contrast emulated,
// and the next starts with the browser's defaults.
it("setup: a test may end with media emulated", async () => {
  await commands.emulateMedia({ reducedMotion: "reduce", contrast: "more" });
  expect(matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
});

it("setup: the next test starts with the browser's media defaults", () => {
  expect(matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(false);
  expect(matchMedia("(prefers-contrast: more)").matches).toBe(false);
});

// The same order again, for the page's real viewport: the first test resizes it directly (as a
// command that bypasses vitest/browser's own page.viewport() channel does), and the next starts
// at the project's configured size again.
it("setup: a test may end with the viewport resized", async () => {
  await commands.setViewport({ width: 555, height: 444 });
  expect(await commands.viewportState()).toEqual({ width: 555, height: 444 });
});

it("setup: the next test starts with the project's viewport again", async () => {
  expect(await commands.viewportState()).not.toEqual({ width: 555, height: 444 });
});

// A file's own beforeAll sets media for all its tests. The middle test changes it and leaves it,
// and the last must still see the file's setting, not the one the middle test left.
describe("setup: media a file sets in beforeAll", () => {
  beforeAll(async () => {
    await commands.emulateMedia({ reducedMotion: "reduce", contrast: "more" });
  });

  it("holds for its first test", () => {
    expect(matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
    expect(matchMedia("(prefers-contrast: more)").matches).toBe(true);
  });

  it("is changed by a test that leaves its own", async () => {
    await commands.emulateMedia({ colorScheme: "dark", contrast: "no-preference" });
    expect(matchMedia("(prefers-contrast: more)").matches).toBe(false);
  });

  it("holds again for the test after one that changed it", () => {
    expect(matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
    expect(matchMedia("(prefers-contrast: more)").matches).toBe(true);
    expect(matchMedia("(prefers-color-scheme: dark)").matches).toBe(false);
  });
});
