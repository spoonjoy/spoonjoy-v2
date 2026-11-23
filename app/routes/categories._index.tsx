import type { Route } from "./+types/categories._index";
import { useLoaderData } from "react-router";
import { ORGANIZER_KIND_COPY, organizerMeta } from "~/components/organizers/organizer-kinds";
import { OrganizerList } from "~/components/organizers/organizer-pages";
import { organizerListLoader } from "~/domains/kitchen";

export function meta() {
  return organizerMeta(ORGANIZER_KIND_COPY.category.listTitle);
}

export function loader(args: Route.LoaderArgs) {
  return organizerListLoader("category", args);
}

export default function CategoriesIndex() {
  return <OrganizerList kind="category" data={useLoaderData<typeof loader>()} />;
}
