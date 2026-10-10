import type { Route } from "./+types/users.$identifier";
import { chefDisplayName } from "~/lib/username";
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
import { getRecipeCoverDisplay } from "~/lib/recipe-cover.server";
import { absoluteUrlFromRequest } from "~/lib/og-image.server";
import { resolveIssuerOrigin } from "~/lib/oauth-metadata.server";
import { requestD1 } from "~/lib/d1-read.server";
import { readChefProfileFromD1, readChefProfileWithPrisma } from "~/lib/chef-profile-reads.server";
import { ShowMore, useAppendingList, useFocusFirstNew } from "~/components/ui/show-more";
import { SpoonsStrip } from "~/components/recipe/SpoonsStrip";
import { LocalDate } from "~/components/ui/local-date";
import { resolveChefAvatarUrl } from "~/lib/chef-avatar";
import { clearCookProgressCache } from "~/lib/cook-session-sync";
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
  coverProvenanceLabel: string | null;
};

const EMPTY_SPOONS: RecentSpoonItem[] = [];

export function meta({ data }: Route.MetaArgs) {
  if (!data) {
    return [
      { title: "Chef - Spoonjoy" },
      { name: "description", content: "Open this Spoonjoy kitchen." },
    ];
  }
  const username = data.profile.username;
  const description = `${username}'s Spoonjoy kitchen — recipes, cookbooks, and the dishes they cook.`;
  return [
    { title: `${username} - Spoonjoy` },
    { name: "description", content: description },
    { property: "og:site_name", content: "Spoonjoy" },
    { property: "og:type", content: "profile" },
    { property: "og:title", content: `${username} on Spoonjoy` },
    { property: "og:description", content: description },
    { property: "og:url", content: data.canonicalUrl },
    { property: "og:image", content: data.ogImageUrl },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: `${username} on Spoonjoy` },
    { name: "twitter:description", content: description },
    { tagName: "link", rel: "canonical", href: data.canonicalUrl },
  ];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const identifier = params.identifier;
  if (!identifier) {
    throw new Response("User not found", { status: 404 });
  }

  const currentUserId = await getUserId(request, context.cloudflare?.env);

  const d1 = requestD1(context);
  const url = new URL(request.url);
  // A page of recipes after the last one shown, as on the public recipe list; one extra
  // row says whether there is another page.
  const after = parseRecipeCursor(url.searchParams.get("after"));
  const readInput = { identifier, recipeLimit: PROFILE_RECIPE_LIMIT + 1, recipeAfter: after };
  const {
    profileUser,
    matchedBy,
    recipes: recipeRows,
    recipeCount,
    cookbooks,
    recentSpoons: recentSpoonsRaw,
    fellowChefsCount,
    kitchenVisitorsCount,
  } = d1
    ? await readChefProfileFromD1(d1, readInput)
    : await readChefProfileWithPrisma(await getRequestDb(context), readInput);

  if (!profileUser) {
    throw new Response("User not found", { status: 404 });
  }

  if (matchedBy === "id") {
    return redirect(`/users/${profileUser.username}${after ? `?after=${encodeURIComponent(after)}` : ""}`);
  }

  const recipes = recipeRows.slice(0, PROFILE_RECIPE_LIMIT);
  const nextCursor = recipeRows.length > PROFILE_RECIPE_LIMIT ? recipes[recipes.length - 1]!.id : null;

  const recipesWithCover = recipes.map(({ covers, ...rest }) => {
    const coverDisplay = getRecipeCoverDisplay(rest, covers);
    return {
      ...rest,
      coverImageUrl: coverDisplay?.displayUrl ?? null,
      coverProvenanceLabel: coverDisplay?.provenanceLabel ?? null,
    };
  });

  const cookbooksWithCover = cookbooks.map(({ recipes: cookbookRecipes, ...cookbook }) => ({
    ...cookbook,
    recipes: cookbookRecipes.map((item) => ({
      ...item,
      recipe: {
        title: item.recipe.title,
        coverImageUrl: getRecipeCoverDisplay(item.recipe, item.recipe.covers)?.displayUrl ?? null,
        coverProvenanceLabel: getRecipeCoverDisplay(item.recipe, item.recipe.covers)?.provenanceLabel ?? null,
      },
    })),
  }));

  const recentSpoons = recentSpoonsRaw.map((spoon) => {
    const coverDisplay = getRecipeCoverDisplay(spoon.recipe, spoon.recipe.covers);
    return {
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
      coverImageUrl: coverDisplay?.displayUrl ?? null,
      coverProvenanceLabel: coverDisplay?.provenanceLabel ?? null,
    };
  });

  const publicOrigin = resolveIssuerOrigin(request.url, context.cloudflare?.env?.SPOONJOY_BASE_URL);
  // Each page of recipes is its own canonical page, as search engines recommend.
  const canonicalUrl = absoluteUrlFromRequest(
    publicOrigin,
    `/users/${profileUser.username}`,
  );
  const ogImageUrl = absoluteUrlFromRequest(
    publicOrigin,
    resolveChefAvatarUrl(profileUser.photoUrl),
  );

  return {
    profile: {
      id: profileUser.id,
      username: profileUser.username,
      photoUrl: profileUser.photoUrl,
      // The instant, not a label: the page shows the viewer's local month (LocalDate).
      joinedAt: profileUser.createdAt.toISOString(),
    },
    canonicalUrl,
    ogImageUrl,
    isOwner: currentUserId === profileUser.id,
    recipes: recipesWithCover,
    recipeCount,
    after,
    nextCursor,
    cookbooks: cookbooksWithCover,
    recentSpoons,
    // What the recent cooks' relative times ("3 hr ago") are measured from, so the server's
    // render and the browser's hydration agree.
    renderedAt: Date.now(),
    fellowChefsCount,
    kitchenVisitorsCount,
  };
}

export const PROFILE_RECIPE_LIMIT = 24;

// Recipe ids are cuids; anything else is ignored rather than sent to the database.
function parseRecipeCursor(raw: string | null): string | null {
  return raw && /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : null;
}

function profileRecipesHref(username: string, cursor: string): string {
  return `/users/${encodeURIComponent(username)}?after=${encodeURIComponent(cursor)}`;
}

type ProfileData = Exclude<Awaited<ReturnType<typeof loader>>, Response>;
const selectProfileRecipesPage = (data: ProfileData) => ({ items: data.recipes, nextCursor: data.nextCursor ?? null });

export default function UserProfile() {
  const {
    profile,
    isOwner,
    recipes: firstPage,
    recipeCount = firstPage.length,
    after = null,
    nextCursor = null,
    cookbooks,
    recentSpoons = EMPTY_SPOONS,
    renderedAt,
    fellowChefsCount = 0,
    kitchenVisitorsCount = 0,
  } = useLoaderData<typeof loader>();
  const profileHref = `/users/${profile.username}`;
  const list = useAppendingList({
    page: { items: firstPage, nextCursor },
    resetKey: `${profile.id}|${after ?? ""}|${firstPage[0]?.id ?? ""}`,
    loadHref: (cursor: string) => profileRecipesHref(profile.username, cursor),
    select: selectProfileRecipesPage,
    noun: "recipes",
  });
  const recipes = list.items;
  const firstNewRef = useFocusFirstNew<HTMLAnchorElement>(list.firstNewIndex);

  return (
    <CookbookPage>
      <section className="mx-auto max-w-6xl">
        <header className="sj-rule-block flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-4">
            <Avatar
              src={resolveChefAvatarUrl(profile.photoUrl)}
              alt={chefDisplayName(profile.username)}
              initials={profile.username.charAt(0).toUpperCase()}
              className="size-18 border border-[var(--sj-border)] bg-[var(--sj-flour)] text-[var(--sj-ink)] shadow-[var(--sj-shadow-soft)]"
            />
            <div>
              <p className="sj-eyebrow">Chef profile</p>
              <Heading level={1} className="mt-2 text-5xl/12 tracking-normal">
                {chefDisplayName(profile.username)}
              </Heading>
              <Text className="mt-1 text-sm">
                Joined <LocalDate value={profile.joinedAt} unit="month" /> • {recipeCount} {recipeCount === 1 ? "recipe" : "recipes"} • {cookbooks.length} {cookbooks.length === 1 ? "cookbook" : "cookbooks"}
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
              <Form method="post" action="/logout" onSubmit={clearCookProgressCache}>
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
                coverProvenanceLabel: recipe.coverProvenanceLabel,
                servings: recipe.servings ?? undefined,
                chefName: profile.username,
              }))}
              totalCount={recipeCount}
              firstNew={{ index: list.firstNewIndex, ref: firstNewRef }}
              emptyTitle={after ? "That's every recipe" : isOwner ? "No recipes yet" : "No public recipes yet"}
              emptyMessage={after
                ? `You've reached ${chefDisplayName(profile.username)}'s oldest recipe.`
                : isOwner ? "Create your first recipe to start your kitchen." : `${chefDisplayName(profile.username)} has not shared any recipes yet.`}
              emptyCtaHref={isOwner && !after ? "/recipes/new" : null}
            />
            {recipes.length > 0 ? (
              <ShowMore
                list={list}
                href={list.nextCursor ? profileRecipesHref(profile.username, list.nextCursor) : null}
                label="Show more recipes"
              />
            ) : null}
          </section>

          {/* A <section aria-labelledby>, not <aside>: root.tsx already wraps every route in a
              <main> landmark, so an <aside> here would nest a complementary landmark inside it
              and fail landmark-complementary-is-top-level. This cookbook list is still worth
              naming as its own region for screen-reader navigation, so it keeps a labelled
              region instead of dropping to a plain <div>. */}
          <section aria-labelledby="chef-cookbooks-heading">
            <div className="mb-4 flex items-center justify-between gap-3">
              <Subheading id="chef-cookbooks-heading" level={2} className="text-2xl/8">Cookbooks</Subheading>
              <Text className="font-sj-ui text-xs uppercase tracking-[0.14em]">{cookbooks.length} total</Text>
            </div>

            {cookbooks.length === 0 ? (
              <div className="border-y border-dashed border-[var(--sj-border-strong)] py-5">
                <Text>
                  {isOwner ? "No cookbooks yet." : `${chefDisplayName(profile.username)} has not shared any cookbooks yet.`}
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
                      coverProvenanceLabel: item.recipe.coverProvenanceLabel,
                    }))}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <SettingsPanel title="Recent cooks">
          <div className="mt-4">
            <SpoonsStrip spoons={recentSpoons} showRecipe now={renderedAt} />
          </div>
        </SettingsPanel>

      </section>
    </CookbookPage>
  );
}
