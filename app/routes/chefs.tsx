import type { Route } from "./+types/chefs";
import { useLoaderData } from "react-router";
import { Users } from "lucide-react";
import { Link } from "~/components/ui/link";
import { Text } from "~/components/ui/text";
import { CookbookHeader, CookbookPage, RuledEmptyState } from "~/components/cookbook/page";
import { getRequestDb } from "~/lib/route-platform.server";
import { listFellowChefs, listKitchenVisitors } from "~/lib/fellow-chefs.server";
import { chefActivity, chefRef } from "~/lib/chef-activity.server";
import { requireUserId } from "~/lib/session.server";
import { LocalDate } from "~/components/ui/local-date";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Chefs - Spoonjoy" },
    { name: "description", content: "Chefs you've cooked, forked, or saved from, and who's cooked from you." },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const userId = await requireUserId(request, "/login", context.cloudflare?.env);
  const database = await getRequestDb(context);
  const viewer = await database.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, username: true, photoUrl: true },
  });
  const viewerRef = chefRef(viewer);
  const [fellowChefs, chefsUsingMyRecipes, activity] = await Promise.all([
    listFellowChefs(database, userId),
    listKitchenVisitors(database, userId),
    chefActivity(database, userId, viewerRef),
  ]);

  return {
    viewer: viewerRef,
    fellowChefs,
    chefsUsingMyRecipes,
    activity,
  };
}

export default function Chefs() {
  const { fellowChefs, chefsUsingMyRecipes, activity } = useLoaderData<typeof loader>();

  return (
    <CookbookPage>
      <CookbookHeader eyebrow="My Kitchen" title="Chefs">
        Fellow chefs, chefs using your recipes, and the latest private activity around your kitchen.
      </CookbookHeader>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <ChefList title="Fellow Chefs" rows={fellowChefs.rows} empty="No fellow chefs yet." />
        <ChefList title="Chefs Using My Recipes" rows={chefsUsingMyRecipes.rows} empty="No one has used your recipes yet." />
      </div>

      <section aria-label="Chef activity" className="mt-10">
        <h2 className="font-sj-display text-2xl/8 font-semibold text-[var(--sj-ink)]">Activity</h2>
        {activity.length > 0 ? (
          <div className="mt-3 divide-y divide-[var(--sj-border)]">
            {activity.map((row) => (
              <article key={row.id} className="py-4">
                <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sj-brass)]">
                  {row.direction === "inbound" ? "In your kitchen" : "From your kitchen"}
                </p>
                <Text className="mt-1">{row.label}</Text>
              </article>
            ))}
          </div>
        ) : (
          <RuledEmptyState title="No chef activity yet">
            <Text>Cook, fork, or save another chef's recipe to start building your kitchen graph.</Text>
          </RuledEmptyState>
        )}
      </section>
    </CookbookPage>
  );
}

function ChefList({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: Array<{ chefId: string; username: string; latestInteractionAt: Date }>;
  empty: string;
}) {
  return (
    <section aria-label={title}>
      <h2 className="font-sj-display text-2xl/8 font-semibold text-[var(--sj-ink)]">{title}</h2>
      {rows.length > 0 ? (
        <div className="mt-3 divide-y divide-[var(--sj-border)]">
          {rows.map((chef) => (
            <Link key={chef.chefId} href={`/?chef=${chef.username}`} className="flex items-center gap-3 py-4 no-underline">
              <span className="grid size-10 place-items-center rounded-full border border-[var(--sj-border)] text-[var(--sj-brass)]">
                <Users className="size-4" aria-hidden="true" />
              </span>
              <span>
                <span className="block font-sj-ui font-bold text-[var(--sj-ink)]">{chef.username}</span>
                <span className="text-sm text-[var(--sj-ink-soft)]">
                  Latest activity <LocalDate value={chef.latestInteractionAt} />
                </span>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <Text className="mt-3">{empty}</Text>
      )}
    </section>
  );
}
