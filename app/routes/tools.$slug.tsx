import type { Route } from "./+types/tools.$slug";
import { useLoaderData } from "react-router";
import { organizerMeta } from "~/components/organizers/organizer-kinds";
import { OrganizerPage } from "~/components/organizers/organizer-pages";
import { organizerPageAction, organizerPageLoader } from "~/domains/kitchen/index.server";

export function meta({ data }: Route.MetaArgs) {
  return organizerMeta(data ? data.organizer.name : "Tool");
}

export function loader({ params, ...args }: Route.LoaderArgs) {
  return organizerPageLoader("tool", { ...args, slug: params.slug });
}

export function action({ params, ...args }: Route.ActionArgs) {
  return organizerPageAction("tool", { ...args, slug: params.slug });
}

export default function ToolPage() {
  return <OrganizerPage kind="tool" data={useLoaderData<typeof loader>()} />;
}
