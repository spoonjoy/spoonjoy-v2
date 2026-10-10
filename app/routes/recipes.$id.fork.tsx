import { redirect, type ActionFunctionArgs, type AppLoadContext } from "react-router";
import { requireUserId } from "~/lib/session.server";
import { getRequestDb } from "~/lib/route-platform.server";
import { requestD1 } from "~/lib/d1-read.server";
import {
  forkRecipe,
  ForkSourceNotFoundError,
  ForkTitleExhaustedError,
} from "~/lib/recipe-fork.server";
import { notifyForkOfMyRecipe } from "~/lib/notification-triggers.server";
import { getVapidConfig, type VapidEnv } from "~/lib/env.server";
import {
  captureException,
  resolvePostHogServerConfig,
  type PostHogServerConfig,
  type PostHogServerEnv,
} from "~/lib/analytics-server";
import { RecipeWriteInFlightError, RecipeWriteKeyConflictError, runDedupedRecipeWrite } from "~/lib/recipe-write-dedupe.server";

/** How long a repeated submit waits for the first one, which the browser no longer follows. */
const IN_FLIGHT_WAIT_MS = 10_000;

interface CloudflareContextLike {
  cloudflare?: {
    env?: (VapidEnv & PostHogServerEnv) | null;
    ctx?: { waitUntil?: (promise: Promise<unknown>) => void };
  };
}

function getCloudflareCtx(context: AppLoadContext): {
  vapidEnv: VapidEnv;
  postHogConfig: PostHogServerConfig;
  waitUntil?: (promise: Promise<unknown>) => void;
} {
  const cf = (context as unknown as CloudflareContextLike).cloudflare;
  const envSource = cf?.env ?? null;
  return {
    vapidEnv: {
      VAPID_PUBLIC_KEY: envSource?.VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY: envSource?.VAPID_PRIVATE_KEY,
      VAPID_SUBJECT: envSource?.VAPID_SUBJECT,
    },
    postHogConfig: resolvePostHogServerConfig(envSource ?? {}),
    waitUntil: cf?.ctx?.waitUntil ? cf.ctx.waitUntil.bind(cf.ctx) : undefined,
  };
}

export async function action({ request, params, context }: ActionFunctionArgs) {
  const viewerId = await requireUserId(request, "/login", context.cloudflare?.env);
  const sourceRecipeId = params.id;
  if (!sourceRecipeId) {
    throw new Response("Not Found", { status: 404 });
  }

  // The fork dialog sends a token made when it opened, so a double submit or a resubmitted form
  // makes one fork, and the repeat is sent to it. A post without one forks every time, as before.
  const formData = await request.formData().catch(() => null);
  const forkToken = formData?.get("forkToken");
  const token = typeof forkToken === "string" && /^[\w-]{8,100}$/.test(forkToken) ? forkToken : null;

  const db = await getRequestDb(context);
  try {
    if (token) {
      const { value } = await runDedupedRecipeWrite({
        db,
        chefId: viewerId,
        operation: "web.fork_recipe",
        key: token,
        request: { sourceRecipeId },
        waitForInFlightMs: IN_FLIGHT_WAIT_MS,
        write: async () => ({ recipeId: await forkAndNotify(db, context, viewerId, sourceRecipeId) }),
      });
      return redirect(`/recipes/${value.recipeId}`);
    }
    return redirect(`/recipes/${await forkAndNotify(db, context, viewerId, sourceRecipeId)}`);
  } catch (err) {
    if (err instanceof ForkSourceNotFoundError) {
      throw new Response("Not Found", { status: 404 });
    }
    if (err instanceof ForkTitleExhaustedError || err instanceof RecipeWriteInFlightError || err instanceof RecipeWriteKeyConflictError) {
      throw new Response("Conflict", { status: 409 });
    }
    // Source-missing (404) and title-exhausted (409) are expected client
    // outcomes handled above. Anything else is an unexpected fork failure
    // (DB/infra fault) that rethrows into the error boundary as an opaque 500 —
    // capture it (fire-and-forget, no-op without PostHog) before it goes silent.
    const { postHogConfig, waitUntil } = getCloudflareCtx(context);
    if (postHogConfig.enabled) {
      const capture = captureException(postHogConfig, {
        error: err,
        distinctId: viewerId,
        route: new URL(request.url).pathname,
        method: request.method,
        extras: { action: "fork_recipe", source_recipe_id: sourceRecipeId },
      });
      if (waitUntil) {
        waitUntil(capture);
      } else {
        void capture;
      }
    }
    throw err;
  }
}

/** Forks the recipe, notifies the source chef, and answers the fork's id. */
async function forkAndNotify(
  db: Awaited<ReturnType<typeof getRequestDb>>,
  context: AppLoadContext,
  viewerId: string,
  sourceRecipeId: string,
): Promise<string> {
  const result = await forkRecipe(db, { sourceRecipeId, viewerId }, requestD1(context));

  // Fire-and-forget: notify the source chef when someone else forked.
  try {
    const { vapidEnv, postHogConfig, waitUntil } = getCloudflareCtx(context);
    const vapid = getVapidConfig(vapidEnv);
    const notifyTask = notifyForkOfMyRecipe(
      db,
      {
        forkedRecipeId: result.recipe.id,
        sourceRecipeId: result.attribution.sourceRecipeId,
        forkerId: viewerId,
        sourceChefId: result.attribution.sourceChef.id,
        appliedTitle: result.appliedTitle,
      },
      { vapid, waitUntil, postHogConfig },
    );
    if (waitUntil) {
      waitUntil(notifyTask);
    } else {
      await notifyTask;
    }
  } catch {
    // VAPID not configured locally — skip silently.
  }

  return result.recipe.id;
}
