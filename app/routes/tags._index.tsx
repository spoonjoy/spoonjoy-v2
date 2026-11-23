import type { Route } from "./+types/tags._index";
import { useLoaderData } from "react-router";
import { ORGANIZER_KIND_COPY, organizerMeta } from "~/components/organizers/organizer-kinds";
import { OrganizerList } from "~/components/organizers/organizer-pages";
import { organizerListLoader } from "~/domains/kitchen/index.server";

export function meta() {
  return organizerMeta(ORGANIZER_KIND_COPY.tag.listTitle);
}

export function loader(args: Route.LoaderArgs) {
  return organizerListLoader("tag", args);
}

export default function TagsIndex() {
  return <OrganizerList kind="tag" data={useLoaderData<typeof loader>()} />;
}
