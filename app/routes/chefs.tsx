import { Empty } from "~/components/ouro/empty/empty";
import type { Route } from "./+types/chefs";
import { chefDisplayName } from "~/lib/username";
import { useLoaderData } from "react-router";
import { Users } from "lucide-react";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { Text } from "~/components/ouro/text/text";
import { CookbookPage } from "~/components/cookbook/page";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { getRequestDb } from "~/lib/route-platform.server";
import { requestD1 } from "~/lib/d1-read.server";
import { loadChefsPageFromD1, type ChefsPageData } from "~/lib/chefs-page-d1.server";
import { listFellowChefs, listKitchenVisitors } from "~/lib/fellow-chefs.server";
import { chefActivity, chefRef } from "~/lib/chef-activity.server";
import { requireUserId } from "~/lib/session.server";
import { hidesChef, loadViewerHides } from "~/lib/moderation.server";
import { LocalDate } from "~/components/ouro/local-date/local-date";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Chefs - Spoonjoy" },
    { name: "description", content: "Chefs you've cooked, forked, or saved from, and who's cooked from you." },
  ];
}

async function loadChefsPageOnPrisma(context: Route.LoaderArgs["context"], userId: string): Promise<ChefsPageData> {
  const database = await getRequestDb(context);
  const viewer = chefRef(await database.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, username: true, photoUrl: true },
  }));
  const [fellowChefs, chefsUsingMyRecipes, activity, hides] = await Promise.all([
    listFellowChefs(database, userId),
    listKitchenVisitors(database, userId),
    chefActivity(database, userId, viewer),
    loadViewerHides(database, userId),
  ]);
  return { viewer, fellowChefs, chefsUsingMyRecipes, activity, hides };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const userId = await requireUserId(request, "/login", context.cloudflare?.env);
  // On the Worker the whole page comes from D1 in one batch; Prisma is only the fallback where there is no binding.
  const d1 = requestD1(context);
  const { viewer: viewerRef, fellowChefs, chefsUsingMyRecipes, activity, hides } = d1
    ? await loadChefsPageFromD1(d1, userId)
    : await loadChefsPageOnPrisma(context, userId);
  const visible = <T extends { chefId: string }>(list: { rows: T[]; total: number }) => ({
    ...list,
    rows: list.rows.filter((row) => !hidesChef(hides, row.chefId)),
  });

  return {
    viewer: viewerRef,
    fellowChefs: visible(fellowChefs),
    chefsUsingMyRecipes: visible(chefsUsingMyRecipes),
    activity: activity.filter((row) => !hidesChef(hides, row.otherChef.id)),
  };
}

export default function Chefs() {
  const { fellowChefs, chefsUsingMyRecipes, activity } = useLoaderData<typeof loader>();

  return (
    <CookbookPage>
      <PageHeader
        eyebrow="My Kitchen"
        title="Chefs"
        size="lg"
        divider
        description="Fellow chefs, chefs using your recipes, and the latest private activity around your kitchen."
      />

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
                <Text tone="muted" className="mt-1">{row.label}</Text>
              </article>
            ))}
          </div>
        ) : (
          <Empty headingLevel={2} align="start" description={<>
            <Text tone="muted">Cook, fork or save another chef's recipe, and that chef shows up here.</Text>
          </>} title="No chef activity yet" />
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
      <ItemGroup aria-label={title} variant="divided" className="mt-3" empty={<Text tone="muted">{empty}</Text>}>
        {rows.map((chef) => (
          <Item
            key={chef.chefId}
            href={`/?chef=${chef.username}`}
            title={chefDisplayName(chef.username)}
            description={<>Latest activity <LocalDate value={chef.latestInteractionAt} /></>}
            media={<Users />}
            mediaSize="icon"
          />
        ))}
      </ItemGroup>
    </section>
  );
}
