// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  nativePushTokenSecret,
  openNativePushToken,
  sealNativePushToken,
  type NativePushDeviceKey,
} from "~/lib/native-push-token.server";
import { signedCookieSettings } from "~/lib/session.server";

const SECRET = "a-session-secret-of-reasonable-length";
const DEVICE: NativePushDeviceKey = { userId: "user-1", deviceId: "device-1", platform: "ios", environment: "production" };
const TOKEN = "a1".repeat(32);

describe("sealed native push tokens", () => {
  it("are sealed under the deployment's session secret", () => {
    const env = { SESSION_SECRET: SECRET };
    expect(nativePushTokenSecret(env)).toBe(signedCookieSettings(env).secret);
    expect(nativePushTokenSecret(null)).toBe(signedCookieSettings(null).secret);
  });

  it("open to the token they were sealed from, and never hold it in the clear", async () => {
    const sealed = await sealNativePushToken(SECRET, DEVICE, TOKEN);
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
    expect(sealed).not.toContain(TOKEN);
    await expect(openNativePushToken(SECRET, DEVICE, sealed)).resolves.toBe(TOKEN);
  });

  it("differ each time the same token is sealed", async () => {
    const [first, second] = [await sealNativePushToken(SECRET, DEVICE, TOKEN), await sealNativePushToken(SECRET, DEVICE, TOKEN)];
    expect(first).not.toBe(second);
  });

  it.each([
    ["another account", { userId: "user-2" }],
    ["another device", { deviceId: "device-2" }],
    ["another platform", { platform: "macos" }],
    ["another environment", { environment: "development" }],
  ])("open as nothing for %s", async (_name, change) => {
    const sealed = await sealNativePushToken(SECRET, DEVICE, TOKEN);
    await expect(openNativePushToken(SECRET, { ...DEVICE, ...change }, sealed)).resolves.toBeNull();
  });

  it("open as nothing under another secret", async () => {
    const sealed = await sealNativePushToken(SECRET, DEVICE, TOKEN);
    await expect(openNativePushToken(`${SECRET}-rotated`, DEVICE, sealed)).resolves.toBeNull();
  });

  it.each([
    ["no token", null],
    ["an empty column", ""],
    ["another version", "v2.aaaa.bbbb"],
    ["a missing part", "v1.aaaa"],
    ["an extra part", "v1.aaaa.bbbb.cccc"],
    ["text that isn't base64", "v1.!!!!.????"],
  ])("open as nothing from %s", async (_name, sealed) => {
    await expect(openNativePushToken(SECRET, DEVICE, sealed)).resolves.toBeNull();
  });
});
