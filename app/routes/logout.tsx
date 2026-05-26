import type { Route } from "./+types/logout";
import { destroyUserSession } from "~/lib/session.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  return destroyUserSession(request, "/login", context.cloudflare?.env);
}

export async function action({ request, context }: Route.ActionArgs) {
  return destroyUserSession(request, "/login", context.cloudflare?.env);
}

export default function Logout() {
  return null;
}
