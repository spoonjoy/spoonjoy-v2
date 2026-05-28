import { describe, expect, it } from "vitest";
import {
  PWA_INSTALL_DISMISSED_STORAGE_KEY,
  PWA_INSTALL_RE_NAG_AFTER_MS,
  parseDismissedAt,
  serializeDismissedAt,
  shouldShowInstallPrompt,
} from "~/lib/pwa-install";

const NOW = 1_700_000_000_000;

describe("shouldShowInstallPrompt", () => {
  it("returns false when the PWA is already installed", () => {
    expect(
      shouldShowInstallPrompt({
        isInstalled: true,
        canPrompt: true,
        dismissedAt: null,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("returns false when the browser hasn't fired beforeinstallprompt", () => {
    expect(
      shouldShowInstallPrompt({
        isInstalled: false,
        canPrompt: false,
        dismissedAt: null,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("returns true when not installed, can prompt, never dismissed", () => {
    expect(
      shouldShowInstallPrompt({
        isInstalled: false,
        canPrompt: true,
        dismissedAt: null,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("returns false when dismissed less than 14 days ago", () => {
    expect(
      shouldShowInstallPrompt({
        isInstalled: false,
        canPrompt: true,
        dismissedAt: NOW - PWA_INSTALL_RE_NAG_AFTER_MS + 1,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("returns true once 14 days have passed since dismissal", () => {
    expect(
      shouldShowInstallPrompt({
        isInstalled: false,
        canPrompt: true,
        dismissedAt: NOW - PWA_INSTALL_RE_NAG_AFTER_MS,
        now: NOW,
      }),
    ).toBe(true);
  });
});

describe("parseDismissedAt", () => {
  it("returns null for missing key", () => {
    expect(parseDismissedAt(null)).toBeNull();
  });

  it("returns null for malformed values", () => {
    expect(parseDismissedAt("")).toBeNull();
    expect(parseDismissedAt("abc")).toBeNull();
    expect(parseDismissedAt("-5")).toBeNull();
    expect(parseDismissedAt("0")).toBeNull();
  });

  it("parses positive integer timestamps", () => {
    expect(parseDismissedAt(String(NOW))).toBe(NOW);
  });
});

describe("serializeDismissedAt", () => {
  it("renders timestamps as decimal strings", () => {
    expect(serializeDismissedAt(NOW)).toBe(String(NOW));
  });
});

describe("constants", () => {
  it("exposes a stable storage key", () => {
    expect(PWA_INSTALL_DISMISSED_STORAGE_KEY).toBe("spoonjoy.pwa-install.dismissed-at");
  });

  it("nag interval is 14 days in ms", () => {
    expect(PWA_INSTALL_RE_NAG_AFTER_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });
});
