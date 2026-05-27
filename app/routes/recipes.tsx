import type { Route } from "./+types/recipes";
import { Outlet } from "react-router";

// This is a public layout route. Child routes that mutate recipes enforce
// authentication in their own loaders/actions.

export async function loader({ request, context }: Route.LoaderArgs) {
  return null;
}

export default function RecipesLayout() {
  return <Outlet />;
}
