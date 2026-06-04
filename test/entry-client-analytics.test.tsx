import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

type PostHogInitOptions = {
  api_host?: string;
  capture_pageview?: boolean;
  capture_pageleave?: boolean;
  capture_exceptions?: boolean;
  session_recording?: {
    maskTextSelector?: string;
    maskAllInputs?: boolean;
  };
};

async function importEntryClientWithEnv(env: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();

  const posthog = { init: vi.fn() };
  const hydrateRoot = vi.fn();

  vi.doMock("posthog-js", () => ({
    default: posthog,
  }));
  vi.doMock("@posthog/react", () => ({
    PostHogProvider: ({ children }: { children: React.ReactNode }) => (
      <React.Fragment>{children}</React.Fragment>
    ),
  }));
  vi.doMock("react-dom/client", () => ({
    hydrateRoot,
  }));
  vi.doMock("react-router/dom", () => ({
    HydratedRouter: () => <div data-testid="hydrated-router" />,
  }));

  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }

  await import("~/entry.client");

  return { hydrateRoot, posthog };
}

afterEach(() => {
  vi.doUnmock("posthog-js");
  vi.doUnmock("@posthog/react");
  vi.doUnmock("react-dom/client");
  vi.doUnmock("react-router/dom");
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("client PostHog bootstrap", () => {
  it("skips PostHog initialization when the build-time key is missing or blank", async () => {
    const missing = await importEntryClientWithEnv({
      VITE_POSTHOG_KEY: "",
      VITE_POSTHOG_DISABLED: "",
    });
    expect(missing.posthog.init).not.toHaveBeenCalled();
    expect(missing.hydrateRoot).toHaveBeenCalledWith(document, expect.anything());

    const whitespace = await importEntryClientWithEnv({
      VITE_POSTHOG_KEY: "   ",
      VITE_POSTHOG_DISABLED: "",
    });
    expect(whitespace.posthog.init).not.toHaveBeenCalled();
    expect(whitespace.hydrateRoot).toHaveBeenCalledWith(document, expect.anything());
  });

  it("skips PostHog initialization when the build-time disabled flag is true-ish", async () => {
    const result = await importEntryClientWithEnv({
      VITE_POSTHOG_KEY: "ph_test_key",
      VITE_POSTHOG_DISABLED: "yes",
    });

    expect(result.posthog.init).not.toHaveBeenCalled();
    expect(result.hydrateRoot).toHaveBeenCalledWith(document, expect.anything());
  });

  it("initializes PostHog with the configured host and privacy-preserving options", async () => {
    const result = await importEntryClientWithEnv({
      VITE_POSTHOG_KEY: " ph_test_key ",
      VITE_POSTHOG_HOST: " https://eu.i.posthog.com ",
      VITE_POSTHOG_DISABLED: "false",
    });

    expect(result.posthog.init).toHaveBeenCalledTimes(1);
    const [key, options] = result.posthog.init.mock.calls[0] as [string, PostHogInitOptions];
    expect(key).toBe("ph_test_key");
    expect(options).toMatchObject({
      api_host: "https://eu.i.posthog.com",
      capture_pageview: false,
      capture_pageleave: true,
      capture_exceptions: true,
      session_recording: {
        maskTextSelector: "*",
        maskAllInputs: true,
      },
    });
    expect(result.hydrateRoot).toHaveBeenCalledWith(document, expect.anything());
  });
});
