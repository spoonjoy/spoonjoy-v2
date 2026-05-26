import type { Route } from "./+types/recipes._index";
import { redirect } from "react-router";
import { requireUserId } from "~/lib/session.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireUserId(request, "/login", context.cloudflare?.env);
  throw redirect("/?tab=recipes");
}

export default function RecipesIndexRedirect() {
  return null;
}
