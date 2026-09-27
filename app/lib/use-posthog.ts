import { usePostHog as usePostHogClient } from "@posthog/react";
import type { PostHog } from "posthog-js";

/**
 * The PostHog client in the browser, and `undefined` on the server, where the Worker build
 * replaces `@posthog/react` with a stand-in (see vite.config.ts). `@posthog/react` types its
 * hook as always returning a client, so components use this wrapper: its type makes every
 * call site guard the client, and an unguarded call during a server render fails typecheck
 * instead of throwing.
 */
export function usePostHog(): PostHog | undefined {
  return usePostHogClient();
}
