import type { Route } from "./+types/tools.$slug";
import { useLoaderData } from "react-router";
import { organizerMeta } from "~/components/organizers/organizer-kinds";
import { OrganizerPage } from "~/components/organizers/organizer-pages";
import { organizerPageLoader } from "~/domains/kitchen";

export function meta({ data }: Route.MetaArgs) {
  return organizerMeta(data ? data.organizer.name : "Tool");
}

export function loader({ params, ...args }: Route.LoaderArgs) {
  return organizerPageLoader("tool", { ...args, slug: params.slug });
}

export default function ToolPage() {
  return <OrganizerPage kind="tool" data={useLoaderData<typeof loader>()} />;
}
