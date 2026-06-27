/**
 * Shared test helpers for asserting server-side PostHog capture posts.
 *
 * Used by the "PostHog config threading" suites that verify notification call
 * sites now resolve `resolvePostHogServerConfig(env)` and thread it through the
 * dispatch deps. They run the real caller + real dispatch and observe the
 * fire-and-forget capture POST that the dispatch emits on a silent push
 * failure. `globalThis.fetch` is intercepted: PostHog capture posts are
 * recorded, and every other request (the push send) is forced to fail so the
 * dispatch reaches its `spoonjoy.push.send_failed` capture path.
 */
import { vi } from "vitest";

/** PostHog capture endpoint path fragment (see `postHogCaptureUrl`). */
export const POSTHOG_CAPTURE_PATH = "/i/v0/e/";

export type CapturedPost = { event?: string; properties?: Record<string, unknown> };

export interface PostHogFetchSpy {
  impl: typeof fetch;
  postHogPosts: CapturedPost[];
}

/**
 * Build a `fetch` double that records PostHog capture posts and forces every
 * push send to return a non-2xx (→ dispatch classifies "failed" → capture).
 * Real push endpoints are never contacted.
 */
export function makePostHogFetchSpy(): PostHogFetchSpy {
  const postHogPosts: CapturedPost[] = [];
  const impl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes(POSTHOG_CAPTURE_PATH)) {
      try {
        postHogPosts.push(JSON.parse((init?.body as string) ?? "{}"));
      } catch {
        postHogPosts.push({});
      }
      return new Response("{}", { status: 200 });
    }
    return new Response("nope", { status: 500 });
  });
  return { impl: impl as unknown as typeof fetch, postHogPosts };
}

/** Capture posts for the dispatch's silent push-failure event. */
export function pushSendFailedPosts(posts: CapturedPost[]): CapturedPost[] {
  return posts.filter((p) => p.event === "spoonjoy.push.send_failed");
}

/**
 * Drain a `waitUntil` queue until it stops growing. Dispatch schedules nested
 * work (per-recipient push sends, then the capture) onto the same queue, so a
 * single `Promise.all` snapshot would miss the later additions.
 */
export async function drainScheduled(scheduled: Promise<unknown>[]): Promise<void> {
  let processed = 0;
  while (processed < scheduled.length) {
    const batch = scheduled.slice(processed);
    processed = scheduled.length;
    await Promise.allSettled(batch);
  }
}
