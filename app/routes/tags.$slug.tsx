import type { Route } from "./+types/tags.$slug";
import { useLoaderData } from "react-router";
import { organizerMeta } from "~/components/organizers/organizer-kinds";
import { OrganizerPage } from "~/components/organizers/organizer-pages";
import { organizerPageAction, organizerPageLoader } from "~/domains/kitchen/index.server";

export function meta({ data }: Route.MetaArgs) {
  return organizerMeta(data ? data.organizer.name : "Tag");
}

export function loader({ params, ...args }: Route.LoaderArgs) {
  return organizerPageLoader("tag", { ...args, slug: params.slug });
}

export function action({ params, ...args }: Route.ActionArgs) {
  return organizerPageAction("tag", { ...args, slug: params.slug });
}

export default function TagPage() {
  return <OrganizerPage kind="tag" data={useLoaderData<typeof loader>()} />;
}
