import { redirect, type ActionFunctionArgs, type AppLoadContext } from "react-router";
import { requireUserId } from "~/lib/session.server";
import { getRequestDb } from "~/lib/route-platform.server";
import {
  forkRecipe,
  ForkSourceNotFoundError,
  ForkTitleExhaustedError,
} from "~/lib/recipe-fork.server";
import { notifyForkOfMyRecipe } from "~/lib/notification-triggers.server";
import { getVapidConfig, type VapidEnv } from "~/lib/env.server";

interface CloudflareContextLike {
  cloudflare?: {
    env?: VapidEnv | null;
    ctx?: { waitUntil?: (promise: Promise<unknown>) => void };
  };
}

function getCloudflareCtx(context: AppLoadContext): {
  vapidEnv: VapidEnv;
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
    waitUntil: cf?.ctx?.waitUntil ? cf.ctx.waitUntil.bind(cf.ctx) : undefined,
  };
}

export async function action({ request, params, context }: ActionFunctionArgs) {
  const viewerId = await requireUserId(request, "/login", context.cloudflare?.env);
  const sourceRecipeId = params.id;
  if (!sourceRecipeId) {
    throw new Response("Not Found", { status: 404 });
  }

  const db = await getRequestDb(context);
  try {
    const result = await forkRecipe(db, { sourceRecipeId, viewerId });

    // Fire-and-forget: notify the source chef when someone else forked.
    try {
      const { vapidEnv, waitUntil } = getCloudflareCtx(context);
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
        { vapid, waitUntil },
      );
      if (waitUntil) {
        waitUntil(notifyTask);
      } else {
        await notifyTask;
      }
    } catch {
      // VAPID not configured locally — skip silently.
    }

    return redirect(`/recipes/${result.recipe.id}`);
  } catch (err) {
    if (err instanceof ForkSourceNotFoundError) {
      throw new Response("Not Found", { status: 404 });
    }
    if (err instanceof ForkTitleExhaustedError) {
      throw new Response("Conflict", { status: 409 });
    }
    throw err;
  }
}
