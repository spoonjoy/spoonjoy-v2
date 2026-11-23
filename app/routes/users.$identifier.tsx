import { Card } from "~/components/ouro/card/card";
import type { Route } from "./+types/users.$identifier";
import { kitchenPageTitle } from "~/lib/seo-titles";
import { chefDisplayName } from "~/lib/username";
import { Form, redirect, useLoaderData } from "react-router";
import { Settings } from "lucide-react";
import { getRequestDb } from "~/lib/route-platform.server";
import { getUserId } from "~/lib/session.server";
import { hidesChef, loadRequestViewerHides, withoutHidden } from "~/lib/moderation.server";
import { ReportOrBlockButton } from "~/components/moderation/ReportOrBlockButton";
import { Avatar } from "~/components/ouro/avatar/avatar";
import { Button } from "~/components/ouro/button/button";
import { Text } from "~/components/ouro/text/text";
import { Link } from "~/components/ouro/link/link";
import { RecipeGrid } from "~/components/pantry/RecipeGrid";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { SectionHeader } from "~/components/ouro/section-header/section-header";
import { Cover } from "~/components/ouro/cover/cover";
import { getRecipeCoverDisplay } from "~/lib/recipe-cover.server";
import { absoluteUrlFromRequest } from "~/lib/og-image.server";
import { resolveIssuerOrigin } from "~/lib/oauth-metadata.server";
import { requestD1 } from "~/lib/d1-read.server";
import { readChefProfileFromD1, readChefProfileWithPrisma } from "~/lib/chef-profile-reads.server";
import { useAppendingList } from "~/hooks/use-appending-list";
import { SpoonsStrip } from "~/components/recipe/SpoonsStrip";
import { LocalDate } from "~/components/ouro/local-date/local-date";
import { resolveChefAvatarUrl } from "~/lib/chef-avatar";
import { clearCookProgressCache } from "~/lib/cook-session-sync";
import { CookbookPage } from "~/components/cookbook/page";

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
  const description = `What ${username} cooks: their recipes and cookbooks on Spoonjoy. Fork any recipe into your own kitchen.`;
  return [
    { title: kitchenPageTitle(username) },
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
  const readInput = { identifier, recipeLimit: PROFILE_RECIPE_LIMIT + 1, recipeAfter: after, viewerId: currentUserId };
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

  // A chef the viewer blocked or reported is hidden from them, as if there were no such chef.
  const hides = await loadRequestViewerHides(context, currentUserId);
  if (hidesChef(hides, profileUser.id)) {
    throw new Response("User not found", { status: 404 });
  }

  if (matchedBy === "id") {
    return redirect(`/users/${profileUser.username}${after ? `?after=${encodeURIComponent(after)}` : ""}`);
  }

  const pageRows = recipeRows.slice(0, PROFILE_RECIPE_LIMIT);
  const nextCursor = recipeRows.length > PROFILE_RECIPE_LIMIT ? pageRows[pageRows.length - 1]!.id : null;
  const recipes = withoutHidden(hides, pageRows, (recipe) => ({ type: "recipe", id: recipe.id, chefId: profileUser.id }));

  const recipesWithCover = recipes.map(({ covers, ...rest }) => {
    const coverDisplay = getRecipeCoverDisplay(rest, covers);
    return {
      ...rest,
      coverImageUrl: coverDisplay?.displayUrl ?? null,
      coverProvenanceLabel: coverDisplay?.provenanceLabel ?? null,
    };
  });

  const cookbooksWithCover = withoutHidden(hides, cookbooks, (cookbook) => ({ type: "cookbook", id: cookbook.id, chefId: profileUser.id })).map(({ recipes: cookbookRecipes, ...cookbook }) => ({
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

  const recentSpoons = withoutHidden(hides, recentSpoonsRaw, (spoon) => ({ type: "spoon", id: spoon.id, chefId: spoon.chef.id })).map((spoon) => {
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
    isAuthenticated: currentUserId !== null,
    recipes: recipesWithCover,
    recipeCount,
    after,
    nextCursor,
    cookbooks: cookbooksWithCover,
    recentSpoons,
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
    isAuthenticated = false,
    recipes: firstPage,
    recipeCount = firstPage.length,
    after = null,
    nextCursor = null,
    cookbooks,
    recentSpoons = EMPTY_SPOONS,
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

  return (
    <CookbookPage>
      <section className="mx-auto max-w-6xl">
        <header className="sj-rule-block flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            {/* The Apple app's header (desk target.md, Chef): the avatar beside the eyebrow, name and
                "Joined", then the kitchen link and the stats row under them. */}
            <div className="flex min-w-0 items-center gap-4">
              <Avatar
                name={chefDisplayName(profile.username)}
                src={resolveChefAvatarUrl(profile.photoUrl)}
                alt={chefDisplayName(profile.username)}
                initials={profile.username.charAt(0).toUpperCase()}
                size="2xl"
              />
              <div className="min-w-0">
                <p className="sj-eyebrow">Chef profile</p>
                {/* Usernames are one long word, so let them break anywhere instead of running off a phone screen. */}
                <h1 data-testid="chef-profile-name" className="font-sj-display mt-2 text-3xl/9 font-semibold tracking-normal text-[var(--sj-ink)] [overflow-wrap:anywhere] sm:text-5xl/12">
                  {chefDisplayName(profile.username)}
                </h1>
                <Text tone="muted" size="sm" className="mt-1">
                  Joined <LocalDate value={profile.joinedAt} format="month" />
                </Text>
              </div>
            </div>
            <p className="m-0 mt-3 text-sm">
              <Link href={`/?chef=${profile.username}`} className="inline-flex min-h-11 items-center">
                Open kitchen view
              </Link>
            </p>
            {/* The Apple app's stats row: recipes, fellow chefs and kitchen visitors, each a large
                number over its name, three to a row on a phone; at large text sizes they wrap whole.
                The last two open their lists. */}
            <nav className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-x-4 gap-y-2" aria-label={`${profile.username} kitchen relationships`}>
              <p className="m-0 flex flex-col">
                <span className="font-sj-display text-3xl/9 font-semibold text-[var(--sj-ink)]">{recipeCount}</span>{" "}
                <span className="font-sj-ui text-sm text-[var(--sj-ink-soft)]">{recipeCount === 1 ? "recipe" : "recipes"}</span>
              </p>
              <Link href={`${profileHref}/fellow-chefs`} inline={false} tone="secondary" className="flex min-h-11 flex-col items-start no-underline">
                <span className="font-sj-display text-3xl/9 font-semibold text-[var(--sj-ink)]">{fellowChefsCount}</span>{" "}
                <span className="font-sj-ui text-sm text-[var(--sj-ink-soft)]">{fellowChefsCount === 1 ? "fellow chef" : "fellow chefs"}</span>
              </Link>
              <Link href={`${profileHref}/kitchen-visitors`} inline={false} tone="secondary" className="flex min-h-11 flex-col items-start no-underline">
                <span className="font-sj-display text-3xl/9 font-semibold text-[var(--sj-ink)]">{kitchenVisitorsCount}</span>{" "}
                <span className="font-sj-ui text-sm text-[var(--sj-ink-soft)]">{kitchenVisitorsCount === 1 ? "kitchen visitor" : "kitchen visitors"}</span>
              </Link>
            </nav>
          </div>

          {isOwner ? (
            <div className="flex items-center gap-2">
              <Button href="/account/settings" variant="outline" tone="secondary" aria-label="Open settings">
                <Settings data-slot="icon" className="size-4" />
                Settings
              </Button>
              <Form method="post" action="/logout" onSubmit={clearCookProgressCache}>
                <Button type="submit" variant="soft" tone="destructive">Log out</Button>
              </Form>
            </div>
          ) : isAuthenticated ? (
            <div className="flex items-center gap-2">
              <ReportOrBlockButton
                targetType="chef"
                targetId={profile.id}
                chefId={profile.id}
                chefUsername={profile.username}
                targetLabel={`@${profile.username}`}
                triggerTestId="profile-report-action"
              />
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
              }))}
              totalCount={recipeCount}
              loadMore={{
                hasMore: Boolean(list.nextCursor),
                loading: list.loading,
                onShowMore: list.showMore,
                href: list.nextCursor ? profileRecipesHref(profile.username, list.nextCursor) : undefined,
              }}
              emptyTitle={after ? "That's every recipe" : isOwner ? "No recipes yet" : "No public recipes yet"}
              emptyMessage={after
                ? `You've reached ${chefDisplayName(profile.username)}'s oldest recipe.`
                : isOwner ? "Create your first recipe to start your kitchen." : `${chefDisplayName(profile.username)} has not shared any recipes yet.`}
              emptyCtaHref={isOwner && !after ? "/recipes/new" : null}
            />
          </section>

          {/* A <section aria-labelledby>, not <aside>: root.tsx already wraps every route in a
              <main> landmark, so an <aside> here would nest a complementary landmark inside it
              and fail landmark-complementary-is-top-level. This cookbook list is still worth
              naming as its own region for screen-reader navigation, so it keeps a labelled
              region instead of dropping to a plain <div>. */}
          <section aria-label="Cookbooks">
            <SectionHeader title="Cookbooks" meta={`${cookbooks.length} ${cookbooks.length === 1 ? "cookbook" : "cookbooks"}`} className="mb-2" />

            {cookbooks.length === 0 ? (
              <Text tone="muted" className="py-5">
                {isOwner ? "No cookbooks yet." : `${chefDisplayName(profile.username)} has not shared any cookbooks yet.`}
              </Text>
            ) : (
              <ItemGroup aria-label="Cookbooks" variant="divided">
                {cookbooks.map((cookbook) => {
                  const photo = cookbook.recipes.find((item) => item.recipe.coverImageUrl)?.recipe.coverImageUrl;
                  return (
                    <Item
                      key={cookbook.id}
                      as="article"
                      href={`/cookbooks/${cookbook.id}`}
                      title={cookbook.title}
                      description={<Text size="sm">{cookbook._count.recipes} {cookbook._count.recipes === 1 ? "recipe" : "recipes"}</Text>}
                      media={photo ? <img src={photo} alt="" /> : <Cover title={cookbook.title} size="fill" shape="square" />}
                      mediaSize="md"
                    />
                  );
                })}
              </ItemGroup>
            )}
          </section>
        </div>

        <Card as="section" headingLevel={2} stackBelow="sm" className="my-4" title="Recent cooks">
          <div className="mt-4">
            <SpoonsStrip spoons={recentSpoons} showRecipe />
          </div>
        </Card>

      </section>
    </CookbookPage>
  );
}
