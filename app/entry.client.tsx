import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import posthog from "posthog-js";
import { PostHogProvider } from "@posthog/react";
import { resolvePostHogConfig } from "~/lib/analytics";

// Initialize PostHog on the client
const posthogConfig = resolvePostHogConfig(import.meta.env);

if (posthogConfig.enabled) {
  posthog.init(posthogConfig.key, {
    api_host: posthogConfig.host,
    capture_pageview: false, // We'll capture manually via React Router
    capture_pageleave: true,
    capture_exceptions: true, // PostHog auto-captures unhandled errors + promise rejections
    session_recording: {
      maskTextSelector: "*", // Mask all text for privacy
      maskAllInputs: true, // Mask form inputs
    },
  });
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <PostHogProvider client={posthog}>
        <HydratedRouter />
      </PostHogProvider>
    </StrictMode>
  );
});
