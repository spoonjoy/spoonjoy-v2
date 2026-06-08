import type { Route } from "./+types/users.$identifier";
import { Form, redirect, useLoaderData } from "react-router";
import { Settings } from "lucide-react";
import { getRequestDb } from "~/lib/route-platform.server";
import { getUserId } from "~/lib/session.server";
import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Heading, Subheading } from "~/components/ui/heading";
import { Text } from "~/components/ui/text";
import { Link } from "~/components/ui/link";
import { RecipeGrid } from "~/components/pantry/RecipeGrid";
import { CookbookCard } from "~/components/pantry/CookbookCard";
import { getRecipeCoverImageUrl } from "~/lib/recipe-cover.server";
import { listSpoonsByChef } from "~/lib/recipe-spoon.server";
import { SpoonsStrip } from "~/components/recipe/SpoonsStrip";
import {
  countFellowChefs,
  countKitchenVisitors,
} from "~/lib/fellow-chefs.server";
import { resolveChefAvatarUrl } from "~/lib/chef-avatar";
import { CookbookPage, SettingsPanel } from "~/components/cookbook/page";

type RecentSpoonItem = {
  id: string;
  cookedAt: string;
  photoUrl: string | null;
  note: string | null;
  nextTime: string | null;
  chef: { id: string; username: string; photoUrl: string | null };
  recipe: { id: string; title: string; chefId: string };
  coverImageUrl: string | null;
};

const EMPTY_SPOONS: RecentSpoonItem[] = [];

function joinedLabel(createdAt: Date) {
  return `Joined ${createdAt.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  })}`;
}

export function meta({ data }: Route.MetaArgs) {
  const username = data?.profile.username ?? "Chef";
  return [
    { title: `${username} - Spoonjoy` },
    { name: "description", content: `Open ${username}'s Spoonjoy kitchen.` },
  ];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const identifier = params.identifier;
  if (!identifier) {
    throw new Response("User not found", { status: 404 });
  }

  const database = await getRequestDb(context);
  const currentUserId = await getUserId(request, context.cloudflare?.env);

  const userByUsername = await database.user.findUnique({
    where: { username: identifier },
    select: {
      id: true,
      username: true,
      photoUrl: true,
      createdAt: true,
    },
  });

  const profileUser = userByUsername ?? await database.user.findUnique({
    where: { id: identifier },
    select: {
      id: true,
      username: true,
      photoUrl: true,
      createdAt: true,
    },
  });

  if (!profileUser) {
    throw new Response("User not found", { status: 404 });
  }

  if (!userByUsername && identifier === profileUser.id) {
    return redirect(`/users/${profileUser.username}`);
  }

  const [recipes, cookbooks, recentSpoonsRaw, fellowChefsCount, kitchenVisitorsCount] = await Promise.all([
    database.recipe.findMany({
      where: {
        chefId: profileUser.id,
        deletedAt: null,
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        description: true,
        servings: true,
        covers: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        },
      },
    }),
    database.cookbook.findMany({
      where: { authorId: profileUser.id },
      orderBy: { updatedAt: "desc" },
      include: {
        _count: {
          select: { recipes: true },
        },
        recipes: {
          take: 4,
          orderBy: { createdAt: "desc" },
          include: {
            recipe: {
              select: {
                title: true,
                covers: {
                  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                },
              },
            },
          },
        },
      },
    }),
    listSpoonsByChef(database, profileUser.id, { limit: 10 }),
    countFellowChefs(database, profileUser.id),
    countKitchenVisitors(database, profileUser.id),
  ]);

  const recipesWithCover = recipes.map(({ covers, ...rest }) => ({
    ...rest,
    coverImageUrl: getRecipeCoverImageUrl(rest, covers),
  }));

  const cookbooksWithCover = cookbooks.map(({ recipes: cookbookRecipes, ...cookbook }) => ({
    ...cookbook,
    recipes: cookbookRecipes.map((item) => ({
      ...item,
      recipe: {
        title: item.recipe.title,
        coverImageUrl: getRecipeCoverImageUrl(
          { id: item.recipeId, title: item.recipe.title },
          item.recipe.covers,
        ),
      },
    })),
  }));

  const recentSpoons = recentSpoonsRaw.map((spoon) => ({
    id: spoon.id,
    cookedAt: spoon.cookedAt.toISOString(),
    photoUrl: spoon.photoUrl,
    note: spoon.note,
    nextTime: spoon.nextTime,
    chef: {
      id: spoon.chef.id,
      username: spoon.chef.username,
      photoUrl: spoon.chef.photoUrl,
    },
    recipe: {
      id: spoon.recipe.id,
      title: spoon.recipe.title,
      chefId: spoon.recipe.chefId,
    },
    coverImageUrl: getRecipeCoverImageUrl(
      { id: spoon.recipe.id, title: spoon.recipe.title },
      spoon.recipe.covers,
    ),
  }));

  return {
    profile: {
      id: profileUser.id,
      username: profileUser.username,
      photoUrl: profileUser.photoUrl,
      joinedLabel: joinedLabel(profileUser.createdAt),
    },
    isOwner: currentUserId === profileUser.id,
    recipes: recipesWithCover,
    cookbooks: cookbooksWithCover,
    recentSpoons,
    fellowChefsCount,
    kitchenVisitorsCount,
  };
}

export default function UserProfile() {
  const {
    profile,
    isOwner,
    recipes,
    cookbooks,
    recentSpoons = EMPTY_SPOONS,
    fellowChefsCount = 0,
    kitchenVisitorsCount = 0,
  } = useLoaderData<typeof loader>();
  const profileHref = `/users/${profile.username}`;

  return (
    <CookbookPage>
      <section className="mx-auto max-w-6xl">
        <header className="sj-rule-block flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-4">
            <Avatar
              src={resolveChefAvatarUrl(profile.photoUrl)}
              alt={profile.username}
              initials={profile.username.charAt(0).toUpperCase()}
              className="size-18 border border-[var(--sj-border)] bg-[var(--sj-flour)] text-[var(--sj-ink)] shadow-[var(--sj-shadow-soft)]"
            />
            <div>
              <p className="sj-eyebrow">Chef profile</p>
              <Heading level={1} className="mt-2 text-5xl/12 tracking-normal">
                {profile.username}
              </Heading>
              <Text className="mt-1 text-sm">
                {profile.joinedLabel} • {recipes.length} {recipes.length === 1 ? "recipe" : "recipes"} • {cookbooks.length} {cookbooks.length === 1 ? "cookbook" : "cookbooks"}
              </Text>
              <Link href={`/?chef=${profile.username}`} className="sj-link mt-2 inline-flex min-h-11 items-center text-sm">
                Open kitchen view
              </Link>
              <nav className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-sj-ui text-sm font-bold" aria-label={`${profile.username} kitchen relationships`}>
                <Link href={`${profileHref}/fellow-chefs`} className="sj-link inline-flex min-h-11 items-center">
                  Fellow chefs · {fellowChefsCount}
                </Link>
                <Link href={`${profileHref}/kitchen-visitors`} className="sj-link inline-flex min-h-11 items-center">
                  Kitchen visitors · {kitchenVisitorsCount}
                </Link>
              </nav>
            </div>
          </div>

          {isOwner ? (
            <div className="flex items-center gap-2">
              <Button href="/account/settings" plain aria-label="Open settings">
                <Settings data-slot="icon" className="size-4" />
                Settings
              </Button>
              <Form method="post" action="/logout">
                <Button type="submit" variant="destructive">Logout</Button>
              </Form>
            </div>
          ) : null}
        </header>

        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
          <section>
            <RecipeGrid
              recipes={recipes.map((recipe) => ({
                id: recipe.id,
                title: recipe.title,
                description: recipe.description ?? undefined,
                coverImageUrl: recipe.coverImageUrl,
                servings: recipe.servings ?? undefined,
                chefName: profile.username,
              }))}
              emptyTitle={isOwner ? "No recipes yet" : "No public recipes yet"}
              emptyMessage={isOwner ? "Create your first recipe to start your kitchen." : `${profile.username} has not shared any recipes yet.`}
              emptyCtaHref={isOwner ? "/recipes/new" : null}
            />
          </section>

          <aside>
            <div className="mb-4 flex items-center justify-between gap-3">
              <Subheading level={2} className="text-2xl/8">Cookbooks</Subheading>
              <Text className="font-sj-ui text-xs uppercase tracking-[0.14em]">{cookbooks.length} total</Text>
            </div>

            {cookbooks.length === 0 ? (
              <div className="border-y border-dashed border-[var(--sj-border-strong)] py-5">
                <Text>
                  {isOwner ? "No cookbooks yet." : `${profile.username} has not shared any cookbooks yet.`}
                </Text>
              </div>
            ) : (
              <div className="space-y-4">
                {cookbooks.map((cookbook) => (
                  <CookbookCard
                    key={cookbook.id}
                    id={cookbook.id}
                    title={cookbook.title}
                    recipeCount={cookbook._count.recipes}
                    recipeImages={cookbook.recipes.map((item) => ({
                      coverImageUrl: item.recipe.coverImageUrl,
                      title: item.recipe.title,
                    }))}
                  />
                ))}
              </div>
            )}
          </aside>
        </div>

        <SettingsPanel title="Recent cooks">
          <div className="mt-4">
            <SpoonsStrip spoons={recentSpoons} showRecipe />
          </div>
        </SettingsPanel>

      </section>
    </CookbookPage>
  );
}
