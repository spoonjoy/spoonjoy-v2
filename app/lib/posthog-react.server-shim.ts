// The server build's stand-in for `@posthog/react` (see vite.config.ts). PostHog runs only
// in the browser: on the server, components call `usePostHog()` during render but use the
// client only in effects and event handlers, which never run on the server. Bundling the
// real package would evaluate all of `posthog-js` on every cold start of the Worker.

/** On the server there is no PostHog client. */
export function usePostHog(): undefined {
  return undefined;
}
