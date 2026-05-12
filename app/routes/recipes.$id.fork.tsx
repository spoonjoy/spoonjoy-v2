import { redirect, type ActionFunctionArgs } from "react-router";
import { requireUserId } from "~/lib/session.server";
import { getRequestDb } from "~/lib/route-platform.server";
import {
  forkRecipe,
  ForkSourceNotFoundError,
  ForkTitleExhaustedError,
} from "~/lib/recipe-fork.server";

export async function action({ request, params, context }: ActionFunctionArgs) {
  const viewerId = await requireUserId(request);
  const sourceRecipeId = params.id;
  if (!sourceRecipeId) {
    throw new Response("Not Found", { status: 404 });
  }

  const db = await getRequestDb(context);
  try {
    const result = await forkRecipe(db, { sourceRecipeId, viewerId });
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
