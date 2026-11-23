import type { Route } from "./+types/categories.$slug";
import { useLoaderData } from "react-router";
import { organizerMeta } from "~/components/organizers/organizer-kinds";
import { OrganizerPage } from "~/components/organizers/organizer-pages";
import { organizerPageLoader } from "~/domains/kitchen";

export function meta({ data }: Route.MetaArgs) {
  return organizerMeta(data ? data.organizer.name : "Category");
}

export function loader({ params, ...args }: Route.LoaderArgs) {
  return organizerPageLoader("category", { ...args, slug: params.slug });
}

export default function CategoryPage() {
  return <OrganizerPage kind="category" data={useLoaderData<typeof loader>()} />;
}
