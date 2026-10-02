import {
  captureException,
  resolvePostHogServerConfig,
  type PostHogServerEnv,
} from "~/lib/analytics-server";

interface RecipeSaveFollowUpOptions {
  /** The Worker env, for PostHog; capture is skipped without one. */
  env: PostHogServerEnv | null | undefined;
  /** Workers `ctx.waitUntil`, so capture outlives the response. Optional. */
  waitUntil?: (promise: Promise<unknown>) => void;
  /** The user whose save this follows. */
  distinctId: string;
  /** The request being served; MCP tool calls have none, so route and method are omitted. */
  request?: Request;
  surface: "recipe_create" | "recipe_edit";
}

/**
 * Runs work that follows a committed recipe save, such as scheduling cover stylization or the
 * placeholder cover. The save has already succeeded and its cover may point at the uploaded
 * image, so a failure here must neither delete that upload nor report the save as failed: it is
 * logged, captured when PostHog is configured, and swallowed, and the caller answers as for any
 * successful save.
 */
export async function runAfterRecipeSave(
  followUp: () => Promise<unknown>,
  { env, waitUntil, distinctId, request, surface }: RecipeSaveFollowUpOptions,
): Promise<void> {
  try {
    await followUp();
  } catch (error) {
    // Logged whether or not PostHog is configured, so the failure is never silent.
    console.error("recipe save follow-up failed", { surface, error });
    const postHogConfig = env
      ? resolvePostHogServerConfig(env)
      : ({ enabled: false, reason: "missing-key" } as const);
    if (!postHogConfig.enabled) return;
    const capture = captureException(postHogConfig, {
      error,
      distinctId,
      ...(request ? { route: new URL(request.url).pathname, method: request.method } : {}),
      extras: { surface, stage: "after_save" },
    });
    if (waitUntil) {
      waitUntil(capture);
    } else {
      void capture;
    }
  }
}
