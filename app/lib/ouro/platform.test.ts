import { afterEach, describe, expect, it } from "vitest";
import { detectPlatform } from "~/lib/ouro/platform";

/** Pretends the browser runs on the platform, through the modern API's name and the legacy one. */
function onPlatform(modern: { platform?: string } | undefined, legacy: string) {
  Object.defineProperty(navigator, "userAgentData", { configurable: true, value: modern });
  Object.defineProperty(navigator, "platform", { configurable: true, value: legacy });
}

afterEach(() => {
  delete (navigator as { userAgentData?: unknown }).userAgentData;
  delete (navigator as { platform?: unknown }).platform;
});

describe("detectPlatform", () => {
  it.each([
    { name: "an Apple platform by the modern API", modern: { platform: "macOS" }, legacy: "Linux x86_64", expected: "apple" },
    { name: "an iPhone by the legacy API", modern: undefined, legacy: "iPhone", expected: "apple" },
    { name: "an iPad by the legacy API", modern: undefined, legacy: "iPad", expected: "apple" },
    { name: "Windows by the modern API", modern: { platform: "Windows" }, legacy: "Linux x86_64", expected: "windows" },
    { name: "Windows by the legacy API, where the modern one gives no platform", modern: {}, legacy: "Win32", expected: "windows" },
    { name: "Linux by the modern API", modern: { platform: "Linux" }, legacy: "Linux x86_64", expected: "other" },
    { name: "a name that only contains win, such as Darwin", modern: { platform: "Darwin" }, legacy: "Linux x86_64", expected: "other" },
    { name: "ChromeOS by the legacy API", modern: undefined, legacy: "Linux x86_64", expected: "other" },
  ])("detects $name as $expected", ({ modern, legacy, expected }) => {
    onPlatform(modern, legacy);
    expect(detectPlatform()).toBe(expected);
  });
});
