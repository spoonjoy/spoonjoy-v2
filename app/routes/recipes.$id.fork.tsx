import { redirect, type ActionFunctionArgs, type AppLoadContext } from "react-router";
import { requireUserId } from "~/lib/session.server";
import { getRequestDb } from "~/lib/route-platform.server";
import { requestD1, type D1ReadDatabase } from "~/lib/d1-read.server";
import {
  forkRecipe,
  forkRecipeOnD1,
  ForkSourceNotFoundError,
  ForkTitleExhaustedError,
  type ForkedRecipeSummary,
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

  // With a D1 binding the fork, its duplicate-submit key and its reads all run on D1, so a fork
  // never builds a Prisma client in the request (only the background notification does).
  const d1 = requestD1(context);
  let prismaClient: ReturnType<typeof getRequestDb> | undefined;
  const prisma = () => (prismaClient ??= getRequestDb(context));
  const fork = d1
    ? () => forkOnD1AndNotify(d1, context, viewerId, sourceRecipeId)
    : async () => forkAndNotify(await prisma(), context, viewerId, sourceRecipeId);
  try {
    if (token) {
      const { value } = await runDedupedRecipeWrite({
        ...(d1 ? { d1 } : { db: await prisma() }),
        chefId: viewerId,
        operation: "web.fork_recipe",
        key: token,
        request: { sourceRecipeId },
        waitForInFlightMs: IN_FLIGHT_WAIT_MS,
        write: async () => ({ recipeId: await fork() }),
      });
      return redirect(`/recipes/${value.recipeId}`);
    }
    return redirect(`/recipes/${await fork()}`);
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

/** Forks the recipe through Prisma, notifies the source chef, and answers the fork's id. */
async function forkAndNotify(
  db: Awaited<ReturnType<typeof getRequestDb>>,
  context: AppLoadContext,
  viewerId: string,
  sourceRecipeId: string,
): Promise<string> {
  const result = await forkRecipe(db, { sourceRecipeId, viewerId });
  await notifySourceChef(context, viewerId, {
    recipeId: result.recipe.id,
    attribution: result.attribution,
    appliedTitle: result.appliedTitle,
  }, async () => db);
  return result.recipe.id;
}

/** Forks the recipe on D1, notifies the source chef, and answers the fork's id. */
async function forkOnD1AndNotify(
  d1: D1ReadDatabase,
  context: AppLoadContext,
  viewerId: string,
  sourceRecipeId: string,
): Promise<string> {
  const result = await forkRecipeOnD1(d1, { sourceRecipeId, viewerId });
  await notifySourceChef(context, viewerId, result, () => getRequestDb(context));
  return result.recipeId;
}

/**
 * Fire-and-forget: notify the source chef when someone else forked. The notification reads
 * through Prisma, so the client is built inside the background task, after the response.
 */
async function notifySourceChef(
  context: AppLoadContext,
  viewerId: string,
  fork: Pick<ForkedRecipeSummary, "recipeId" | "attribution" | "appliedTitle">,
  getDb: () => Promise<Awaited<ReturnType<typeof getRequestDb>>>,
): Promise<void> {
  try {
    const { vapidEnv, postHogConfig, waitUntil } = getCloudflareCtx(context);
    const vapid = getVapidConfig(vapidEnv);
    const notifyTask = (async () => notifyForkOfMyRecipe(
      await getDb(),
      {
        forkedRecipeId: fork.recipeId,
        sourceRecipeId: fork.attribution.sourceRecipeId,
        forkerId: viewerId,
        sourceChefId: fork.attribution.sourceChef.id,
        appliedTitle: fork.appliedTitle,
      },
      { vapid, waitUntil, postHogConfig },
    ))();
    if (waitUntil) {
      waitUntil(notifyTask);
    } else {
      await notifyTask;
    }
  } catch {
    // VAPID not configured locally — skip silently.
  }
}
