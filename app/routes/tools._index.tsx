import type { Route } from "./+types/tools._index";
import { useLoaderData } from "react-router";
import { ORGANIZER_KIND_COPY, organizerMeta } from "~/components/organizers/organizer-kinds";
import { OrganizerList } from "~/components/organizers/organizer-pages";
import { organizerListLoader } from "~/domains/kitchen/index.server";

export function meta() {
  return organizerMeta(ORGANIZER_KIND_COPY.tool.listTitle);
}

export function loader(args: Route.LoaderArgs) {
  return organizerListLoader("tool", args);
}

export default function ToolsIndex() {
  return <OrganizerList kind="tool" data={useLoaderData<typeof loader>()} />;
}
