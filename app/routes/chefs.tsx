import type { Route } from "./+types/chefs";
import { useLoaderData } from "react-router";
import { Users } from "lucide-react";
import { Link } from "~/components/ui/link";
import { Text } from "~/components/ui/text";
import { CookbookHeader, CookbookPage, RuledEmptyState } from "~/components/cookbook/page";
import { getRequestDb } from "~/lib/route-platform.server";
import { listFellowChefs, listKitchenVisitors } from "~/lib/fellow-chefs.server";
import { requireUserId } from "~/lib/session.server";

type ChefRef = {
  id: string;
  username: string;
  photoUrl: string | null;
};

type ActivityKind = "spooned" | "forked" | "saved";
type ActivityDirection = "outbound" | "inbound";
type ActivitySourceKind = "fork" | "save" | "spoon";

type ChefActivityRow = {
  id: string;
  sourceId: string;
  sourceKind: ActivitySourceKind;
  kind: ActivityKind;
  direction: ActivityDirection;
  eventAt: Date;
  actor: ChefRef;
  otherChef: ChefRef;
  recipe: { id: string; title: string } | null;
  cookbook: { id: string; title: string } | null;
  label: string;
};

function chefRef(chef: { id: string; username: string; photoUrl: string | null }): ChefRef {
  return {
    id: chef.id,
    username: chef.username,
    photoUrl: chef.photoUrl,
  };
}

function activityId(direction: ActivityDirection, sourceKind: ActivitySourceKind, sourceId: string) {
  return `${direction}:${sourceKind}:${sourceId}`;
}

function compareActivity(a: ChefActivityRow, b: ChefActivityRow) {
  const timeDiff = b.eventAt.getTime() - a.eventAt.getTime();
  if (timeDiff !== 0) return timeDiff;
  const sourceDiff = a.sourceKind.localeCompare(b.sourceKind);
  if (sourceDiff !== 0) return sourceDiff;
  return b.sourceId.localeCompare(a.sourceId);
}

async function chefActivity(database: Awaited<ReturnType<typeof getRequestDb>>, userId: string, viewer: ChefRef) {
  const [outboundSpoons, inboundSpoons, outboundForks, inboundForks, outboundSaves, inboundSaves] =
    await Promise.all([
      database.recipeSpoon.findMany({
        where: {
          chefId: userId,
          deletedAt: null,
          recipe: {
            deletedAt: null,
            chefId: { not: userId },
          },
        },
        include: {
          recipe: {
            include: {
              chef: { select: { id: true, username: true, photoUrl: true } },
            },
          },
        },
      }),
      database.recipeSpoon.findMany({
        where: {
          chefId: { not: userId },
          deletedAt: null,
          recipe: {
            chefId: userId,
            deletedAt: null,
          },
        },
        include: {
          chef: { select: { id: true, username: true, photoUrl: true } },
          recipe: { select: { id: true, title: true } },
        },
      }),
      database.recipe.findMany({
        where: {
          chefId: userId,
          deletedAt: null,
          sourceRecipeId: { not: null },
          sourceRecipe: {
            deletedAt: null,
            chefId: { not: userId },
          },
        },
        include: {
          sourceRecipe: {
            include: {
              chef: { select: { id: true, username: true, photoUrl: true } },
            },
          },
        },
      }),
      database.recipe.findMany({
        where: {
          chefId: { not: userId },
          deletedAt: null,
          sourceRecipe: {
            chefId: userId,
            deletedAt: null,
          },
        },
        include: {
          chef: { select: { id: true, username: true, photoUrl: true } },
          sourceRecipe: { select: { id: true, title: true } },
        },
      }),
      database.recipeInCookbook.findMany({
        where: {
          addedById: userId,
          recipe: {
            deletedAt: null,
            chefId: { not: userId },
          },
        },
        include: {
          cookbook: { select: { id: true, title: true } },
          recipe: {
            include: {
              chef: { select: { id: true, username: true, photoUrl: true } },
            },
          },
        },
      }),
      database.recipeInCookbook.findMany({
        where: {
          addedById: { not: userId },
          recipe: {
            chefId: userId,
            deletedAt: null,
          },
        },
        include: {
          addedBy: { select: { id: true, username: true, photoUrl: true } },
          cookbook: { select: { id: true, title: true } },
          recipe: { select: { id: true, title: true } },
        },
      }),
    ]);

  const rows: ChefActivityRow[] = [
    ...outboundSpoons.map((spoon) => {
      const otherChef = chefRef(spoon.recipe.chef);
      return {
        id: activityId("outbound", "spoon", spoon.id),
        sourceId: spoon.id,
        sourceKind: "spoon" as const,
        kind: "spooned" as const,
        direction: "outbound" as const,
        eventAt: spoon.cookedAt,
        actor: viewer,
        otherChef,
        recipe: { id: spoon.recipe.id, title: spoon.recipe.title },
        cookbook: null,
        label: `You cooked ${spoon.recipe.title} from ${otherChef.username}.`,
      };
    }),
    ...inboundSpoons.map((spoon) => {
      const actor = chefRef(spoon.chef);
      return {
        id: activityId("inbound", "spoon", spoon.id),
        sourceId: spoon.id,
        sourceKind: "spoon" as const,
        kind: "spooned" as const,
        direction: "inbound" as const,
        eventAt: spoon.cookedAt,
        actor,
        otherChef: actor,
        recipe: { id: spoon.recipe.id, title: spoon.recipe.title },
        cookbook: null,
        label: `${actor.username} cooked your ${spoon.recipe.title}.`,
      };
    }),
    ...outboundForks.map((fork) => {
      const sourceRecipe = fork.sourceRecipe!;
      const otherChef = chefRef(sourceRecipe.chef);
      return {
        id: activityId("outbound", "fork", fork.id),
        sourceId: fork.id,
        sourceKind: "fork" as const,
        kind: "forked" as const,
        direction: "outbound" as const,
        eventAt: fork.createdAt,
        actor: viewer,
        otherChef,
        recipe: { id: sourceRecipe.id, title: sourceRecipe.title },
        cookbook: null,
        label: `You forked ${sourceRecipe.title} from ${otherChef.username}.`,
      };
    }),
    ...inboundForks.map((fork) => {
      const actor = chefRef(fork.chef);
      return {
        id: activityId("inbound", "fork", fork.id),
        sourceId: fork.id,
        sourceKind: "fork" as const,
        kind: "forked" as const,
        direction: "inbound" as const,
        eventAt: fork.createdAt,
        actor,
        otherChef: actor,
        recipe: { id: fork.sourceRecipe!.id, title: fork.sourceRecipe!.title },
        cookbook: null,
        label: `${actor.username} forked your ${fork.sourceRecipe!.title}.`,
      };
    }),
    ...outboundSaves.map((save) => {
      const otherChef = chefRef(save.recipe.chef);
      return {
        id: activityId("outbound", "save", save.id),
        sourceId: save.id,
        sourceKind: "save" as const,
        kind: "saved" as const,
        direction: "outbound" as const,
        eventAt: save.createdAt,
        actor: viewer,
        otherChef,
        recipe: { id: save.recipe.id, title: save.recipe.title },
        cookbook: save.cookbook,
        label: `You saved ${save.recipe.title} from ${otherChef.username}.`,
      };
    }),
    ...inboundSaves.map((save) => {
      const actor = chefRef(save.addedBy);
      return {
        id: activityId("inbound", "save", save.id),
        sourceId: save.id,
        sourceKind: "save" as const,
        kind: "saved" as const,
        direction: "inbound" as const,
        eventAt: save.createdAt,
        actor,
        otherChef: actor,
        recipe: save.recipe,
        cookbook: save.cookbook,
        label: `${actor.username} saved your ${save.recipe.title}.`,
      };
    }),
  ];

  return rows.sort(compareActivity).slice(0, 50);
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
                  Latest activity {new Date(chef.latestInteractionAt).toLocaleDateString()}
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
